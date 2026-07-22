import { io } from 'socket.io-client'
import { readonly, shallowRef, type Ref } from 'vue'

export type ServerSocketIdentity = {
	sessionId: string
	workspaceId: string
	portfolioId: string
}

type ServerSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

type ServerSocketConnection = {
	status: Readonly<Ref<ServerSocketStatus>>
	connect: (identity: ServerSocketIdentity) => Promise<void>
	reconnect: (identity: ServerSocketIdentity) => Promise<void>
	disconnect: () => void
}

type SocketClient = {
	connected: boolean
	active: boolean
	on: (event: string, listener: (...args: unknown[]) => void) => SocketClient
	connect: () => SocketClient
	disconnect: () => SocketClient
}

type ServerSocketRuntimeInput = {
	origin: () => string
	createClient: (url: string, options: Record<string, unknown>) => SocketClient
}

const connectionTimeoutMs = 10_000
export const serverSocketUnavailableMessage = 'Live connection is temporarily unavailable.'
const serverSocketRuntimeKey = Symbol('gorchestra.server-socket.runtime')

type NuxtAppWithServerSocketRuntime = ReturnType<typeof useNuxtApp> & {
	[serverSocketRuntimeKey]?: ServerSocketConnection
}

function createServerSocketRuntime(input: ServerSocketRuntimeInput): ServerSocketConnection {
	const status = shallowRef<ServerSocketStatus>('disconnected')
	let client: SocketClient | null = null
	let identityKey: string | null = null
	let generation = 0
	let readiness: {
		promise: Promise<void>
		resolve: () => void
		reject: (error: Error) => void
		timeout: ReturnType<typeof setTimeout>
		generation: number
	} | null = null

	function connect(identity: ServerSocketIdentity): Promise<void> {
		const nextIdentityKey = serializeIdentity(identity)
		if (identityKey !== nextIdentityKey) replaceClient(nextIdentityKey)
		if (client?.connected === true) return Promise.resolve()
		if (readiness !== null) return readiness.promise
		if (client === null) replaceClient(nextIdentityKey)

		const readinessGeneration = generation
		let resolveReadiness!: () => void
		let rejectReadiness!: (error: Error) => void
		const promise = new Promise<void>((resolve, reject) => {
			resolveReadiness = resolve
			rejectReadiness = reject
		})
		readiness = {
			promise,
			resolve: resolveReadiness,
			reject: rejectReadiness,
			generation: readinessGeneration,
			timeout: setTimeout(() => {
				if (readiness?.generation !== readinessGeneration) return
				const expired = readiness
				readiness = null
				status.value = client?.active === true ? 'reconnecting' : 'disconnected'
				expired.reject(new Error(serverSocketUnavailableMessage))
			}, connectionTimeoutMs),
		}
		status.value = 'connecting'
		client?.connect()
		return promise
	}

	function reconnect(identity: ServerSocketIdentity): Promise<void> {
		closeCurrentClient()
		return connect(identity)
	}

	function replaceClient(nextIdentityKey: string): void {
		closeCurrentClient()
		generation += 1
		identityKey = nextIdentityKey
		const clientGeneration = generation
		const nextClient = input.createClient(input.origin(), {
			path: '/socket.io',
			transports: ['websocket'],
			withCredentials: true,
			autoConnect: false,
		})
		client = nextClient
		nextClient.on('connect', () => {
			if (client !== nextClient || generation !== clientGeneration) return
			status.value = 'connected'
			settleReadiness(clientGeneration)
		})
		nextClient.on('disconnect', () => {
			if (client !== nextClient || generation !== clientGeneration) return
			status.value = nextClient.active ? 'reconnecting' : 'disconnected'
		})
		nextClient.on('connect_error', () => {
			if (client !== nextClient || generation !== clientGeneration) return
			status.value = 'reconnecting'
		})
	}

	function settleReadiness(clientGeneration: number): void {
		if (readiness?.generation !== clientGeneration) return
		const connected = readiness
		readiness = null
		clearTimeout(connected.timeout)
		connected.resolve()
	}

	function closeCurrentClient(): void {
		generation += 1
		if (readiness !== null) {
			const cancelled = readiness
			readiness = null
			clearTimeout(cancelled.timeout)
			cancelled.reject(new Error(serverSocketUnavailableMessage))
		}
		client?.disconnect()
		client = null
		identityKey = null
		status.value = 'disconnected'
	}

	return { status: readonly(status), connect, reconnect, disconnect: closeCurrentClient }
}

function serializeIdentity(identity: ServerSocketIdentity): string {
	return `${identity.sessionId}:${identity.workspaceId}:${identity.portfolioId}`
}

function createBrowserServerSocketRuntime(): ServerSocketConnection {
	return createServerSocketRuntime({
		origin: () => window.location.origin,
		createClient: (url, options) => io(url, options),
	})
}

export function useServerSocketConnection(): ServerSocketConnection {
	if (typeof window === 'undefined') throw new Error('Server Socket connection requires a browser runtime')
	const nuxtApp = tryUseNuxtApp()
	if (nuxtApp === null) throw new Error('Server Socket connection requires an active Nuxt app context')
	const appWithSocket = nuxtApp as NuxtAppWithServerSocketRuntime
	if (appWithSocket[serverSocketRuntimeKey] === undefined) appWithSocket[serverSocketRuntimeKey] = createBrowserServerSocketRuntime()
	return appWithSocket[serverSocketRuntimeKey]
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it, vi } = import.meta.vitest

	afterEach(() => vi.useRealTimers())

	describe('Server Socket connection', () => {
		it('connects one private same-origin WebSocket client without duplicating cookie credentials', async () => {
			const clients: FakeSocket[] = []
			const calls: Array<{ url: string; options: Record<string, unknown> }> = []
			const connection = createServerSocketRuntime({
				origin: () => 'https://gorchestra.example',
				createClient: (url, options) => {
					calls.push({ url, options })
					const client = new FakeSocket()
					clients.push(client)
					return client
				},
			})

			const ready = connection.connect({ sessionId: 'session-1', workspaceId: 'workspace-1', portfolioId: 'portfolio-1' })
			expect(calls).toEqual([
				{
					url: 'https://gorchestra.example',
					options: {
						path: '/socket.io',
						transports: ['websocket'],
						withCredentials: true,
						autoConnect: false,
					},
				},
			])
			expect(clients[0]?.connectCalls).toBe(1)

			clients[0]?.dispatch('connect')
			await expect(ready).resolves.toBeUndefined()
			expect(connection.status.value).toBe('connected')
		})

		it('coalesces concurrent readiness for the same selected identity', async () => {
			const clients: FakeSocket[] = []
			const connection = testConnection(clients)
			const identity = { sessionId: 'session-1', workspaceId: 'workspace-1', portfolioId: 'portfolio-1' }

			const first = connection.connect(identity)
			const second = connection.connect(identity)
			expect(second).toBe(first)
			expect(clients).toHaveLength(1)
			expect(clients[0]?.connectCalls).toBe(1)

			clients[0]?.dispatch('connect')
			await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
		})

		it('replaces changed selected identity and fences stale client callbacks', async () => {
			const clients: FakeSocket[] = []
			const connection = testConnection(clients)
			const first = connection.connect({ sessionId: 'session-1', workspaceId: 'workspace-1', portfolioId: 'portfolio-1' })
			const firstOutcome = first.catch((error: unknown) => error)

			const second = connection.connect({ sessionId: 'session-2', workspaceId: 'workspace-1', portfolioId: 'portfolio-2' })
			expect(clients).toHaveLength(2)
			expect(clients[0]?.disconnectCalls).toBe(1)
			clients[0]?.dispatch('connect')
			expect(connection.status.value).toBe('connecting')
			clients[1]?.dispatch('connect')

			await expect(firstOutcome).resolves.toEqual(new Error(serverSocketUnavailableMessage))
			await expect(second).resolves.toBeUndefined()
			expect(connection.status.value).toBe('connected')
		})

		it('explicitly reconnects the same selected identity with a new client', async () => {
			const clients: FakeSocket[] = []
			const connection = testConnection(clients)
			const identity = { sessionId: 'session-1', workspaceId: 'workspace-1', portfolioId: 'portfolio-1' }
			const first = connection.connect(identity)
			clients[0]?.dispatch('connect')
			await first

			const replacement = connection.reconnect(identity)
			expect(clients).toHaveLength(2)
			expect(clients[0]?.disconnectCalls).toBe(1)
			clients[1]?.dispatch('connect')
			await expect(replacement).resolves.toBeUndefined()
		})

		it('disconnects the client and cancels pending readiness', async () => {
			const clients: FakeSocket[] = []
			const connection = testConnection(clients)
			const pending = connection
				.connect({ sessionId: 'session-1', workspaceId: 'workspace-1', portfolioId: 'portfolio-1' })
				.catch((error: unknown) => error)

			connection.disconnect()
			expect(clients[0]?.disconnectCalls).toBe(1)
			expect(connection.status.value).toBe('disconnected')
			clients[0]?.dispatch('connect')

			await expect(pending).resolves.toEqual(new Error(serverSocketUnavailableMessage))
			expect(connection.status.value).toBe('disconnected')
		})

		it('keeps selected UI alive while transport reconnects', async () => {
			const clients: FakeSocket[] = []
			const connection = testConnection(clients)
			const ready = connection.connect({ sessionId: 'session-1', workspaceId: 'workspace-1', portfolioId: 'portfolio-1' })
			clients[0]?.dispatch('connect')
			await ready

			clients[0]?.dispatch('disconnect', 'transport close')
			expect(connection.status.value).toBe('reconnecting')
			clients[0]?.dispatch('connect')
			expect(connection.status.value).toBe('connected')
		})

		it('rejects coalesced readiness only after the connection deadline', async () => {
			vi.useFakeTimers()
			const clients: FakeSocket[] = []
			const connection = testConnection(clients)
			const identity = { sessionId: 'session-1', workspaceId: 'workspace-1', portfolioId: 'portfolio-1' }
			const first = connection.connect(identity)
			const second = connection.connect(identity)
			const failures = Promise.all([first.catch((error: unknown) => error), second.catch((error: unknown) => error)])

			await vi.advanceTimersByTimeAsync(connectionTimeoutMs - 1)
			expect(connection.status.value).toBe('connecting')
			await vi.advanceTimersByTimeAsync(1)

			await expect(failures).resolves.toEqual([new Error(serverSocketUnavailableMessage), new Error(serverSocketUnavailableMessage)])
			expect(connection.status.value).toBe('reconnecting')
		})
	})

	function testConnection(clients: FakeSocket[]): ServerSocketConnection {
		return createServerSocketRuntime({
			origin: () => 'https://gorchestra.example',
			createClient: () => {
				const client = new FakeSocket()
				clients.push(client)
				return client
			},
		})
	}

	class FakeSocket {
		connected = false
		active = true
		connectCalls = 0
		disconnectCalls = 0
		readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()

		on(event: string, listener: (...args: unknown[]) => void): this {
			const listeners = this.listeners.get(event) ?? new Set()
			listeners.add(listener)
			this.listeners.set(event, listeners)
			return this
		}

		connect(): this {
			this.connectCalls += 1
			return this
		}

		disconnect(): this {
			this.disconnectCalls += 1
			this.connected = false
			this.active = false
			return this
		}

		dispatch(event: string, ...args: unknown[]): void {
			if (event === 'connect') {
				this.connected = true
				this.active = true
			}
			if (event === 'disconnect') this.connected = false
			for (const listener of this.listeners.get(event) ?? []) listener(...args)
		}
	}
}
