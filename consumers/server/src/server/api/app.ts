import { Router } from 'equipped/server'
import { FastifyServer } from 'equipped/server/adapters/fastify'

import { ensureServerInstance } from '../instance'
import type { ServerApiContext } from './context'
import { createAuthApiRouter } from './routes/auth'
import { createPortfolioApiRouter } from './routes/portfolio'
import { createSelectionApiRouter } from './routes/selection'
import { createWorkspaceApiRouter } from './routes/workspace'
import { createSelectedPortfolioSocketAuthMethod } from '../sockets/auth'

const buildServerApiRouter = (context: ServerApiContext) =>
	new Router({ path: '/api' })
		.nest(createAuthApiRouter(context))
		.nest(createWorkspaceApiRouter(context))
		.nest(createSelectionApiRouter(context))
		.nest(createPortfolioApiRouter(context))

export type ServerApiRouter = ReturnType<typeof buildServerApiRouter>

export function createServerApiRouter(context: ServerApiContext): ServerApiRouter {
	return buildServerApiRouter(context)
}

const buildServerApiServer = (context: ServerApiContext, port: number) => {
	ensureServerInstance()
	return FastifyServer.create({
		port,
		cors: { origin: true, credentials: true },
		socketsAuthMethods: [createSelectedPortfolioSocketAuthMethod(context)],
		healthPath: '/api/health',
		openapi: { docsPath: '/api/__docs' },
		requests: {
			log: false,
			rateLimit: { enabled: false },
			slowdown: { enabled: false },
		},
	}).addRouter(createServerApiRouter(context))
}

export type ServerApiServer = ReturnType<typeof buildServerApiServer>

export function createServerApiServer(context: ServerApiContext, port: number): ServerApiServer {
	return buildServerApiServer(context, port)
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { io } = await import('socket.io-client')
	type ClientSocket = ReturnType<typeof io>
	const { createTestServerCache } = await import('../testing/server-cache')
	const { createTempServerStorageTestHarness } = await import('../testing/server-storage')
	const { openServerStorage } = await import('../storage/repo')
	const { createUser } = await import('../modules/identities')
	const { createWorkspaceForUser } = await import('../modules/workspace-creation')
	const { createPortfolioRegistryEntry } = await import('../modules/workspaces')
	const { createSession, sessionCookieName } = await import('../modules/sessions')
	const { buildSelectionCookie, selectionCookieName } = await import('../modules/selection-cookie')
	const { createServerApiContext } = await import('./context')
	const { cleanupTempServerStorage, createTempServerDataDir } = createTempServerStorageTestHarness(
		'gorchestra-server-socket-integration-',
	)
	const now = new Date('2026-07-21T23:00:00.000Z')
	const sessionSigningKey = 'socket-integration-session-key'
	const selectionSigningKey = 'socket-integration-selection-key'

	afterEach(cleanupTempServerStorage)

	describe('Server Socket.IO connection', () => {
		it('connects over WebSocket and resolves existing Session and Selection cookies for Equipped paths', async () => {
			const serverStorage = await openServerStorage({ dataDir: await createTempServerDataDir() })
			const clients: ClientSocket[] = []
			let server: ServerApiServer | null = null
			try {
				const serverCache = createTestServerCache()
				const user = await createUser({ serverStorage, now })
				const workspace = await createWorkspaceForUser({ serverStorage, userId: user.id, displayName: 'Workspace', now })
				const portfolio = await createPortfolioRegistryEntry({
					serverStorage,
					workspaceId: workspace.workspace.id,
					displayName: 'Portfolio',
					coreStorageNamespace: 'portfolios/socket-integration',
					now,
				})
				const session = await createSession({
					serverCache,
					userId: user.id,
					email: 'person@example.com',
					now,
					signingKey: sessionSigningKey,
				})
				const selection = buildSelectionCookie({
					workspaceId: workspace.workspace.id,
					portfolioId: portfolio.id,
					now,
					signingKey: selectionSigningKey,
				})
				server = createServerApiServer(
					createServerApiContext({
						serverStorage,
						serverCache,
						corePortfolioStorage: { type: 'json', dataDir: await createTempServerDataDir() },
						security: {
							sessionSigningKey,
							selectionSigningKey,
							secretEncryptionKey: Buffer.alloc(32, 1),
						},
						portfolioCores: {
							start: () => Promise.resolve(),
							portfolioRegistered: () => {},
							borrow: () => Promise.resolve({ ok: false as const, error: { type: 'portfolio-core-unavailable' as const } }),
							close: () => Promise.resolve(),
						},
						now: () => now,
					}),
					0,
				)
				type TestHttpServer = Parameters<Parameters<ServerApiServer['onBeforeListen']>[0]>[0]['httpServer']
				const rawHttpServer: { current: TestHttpServer | null } = { current: null }
				server.onBeforeListen(({ httpServer }) => {
					rawHttpServer.current = httpServer
				})
				let joinedUser: unknown = null
				server.socket.register('test/selected', ({ user: connectedUser }) => {
					joinedUser = connectedUser
					return Promise.resolve('selected')
				})
				let authenticatedUserId: string | null = null
				let resolveAuthenticated: (() => void) | null = null
				const authenticated = new Promise<void>((resolve) => {
					resolveAuthenticated = resolve
				})
				server.socket.connectionCallbacks = {
					onConnect: (userId) => {
						authenticatedUserId = userId
						resolveAuthenticated?.()
						return Promise.resolve()
					},
					onDisconnect: () => Promise.resolve(),
				}
				await server.start()
				const address = rawHttpServer.current?.address()
				if (address === null || typeof address === 'string' || address === undefined)
					throw new Error('Expected a listening test server')
				const url = `http://127.0.0.1:${address.port}`
				const validClient = io(url, {
					path: '/socket.io',
					transports: ['websocket'],
					withCredentials: true,
					reconnection: false,
					forceNew: true,
					extraHeaders: {
						cookie: `${sessionCookieName}=${session.token}; ${selectionCookieName}=${selection.token}`,
					},
				})
				clients.push(validClient)
				await waitForSocketEvent(validClient, 'connect')
				await withTimeout(authenticated, 'Timed out waiting for selected socket authentication')
				await validClient.timeout(2_000).emitWithAck('join', { channel: 'test/selected', query: {} })

				expect(authenticatedUserId).toBe(user.id)
				expect(joinedUser).toEqual({
					id: user.id,
					sessionId: session.session.sessionId,
					workspaceId: workspace.workspace.id,
					portfolioId: portfolio.id,
					workspaceMemberId: workspace.workspaceMember.id,
				})
				const anonymousClient = io(url, {
					path: '/socket.io',
					transports: ['websocket'],
					withCredentials: true,
					reconnection: false,
					forceNew: true,
					extraHeaders: { cookie: `${sessionCookieName}=${session.token}` },
				})
				clients.push(anonymousClient)
				await waitForSocketEvent(anonymousClient, 'connect')
				expect(anonymousClient.connected).toBe(true)

				const disconnected = clients.map(async (client) => await waitForSocketEvent(client, 'disconnect'))
				await server.socket.socketInstance.close()
				server = null
				await Promise.all(disconnected)
				expect(rawHttpServer.current?.listening).toBe(false)
			} finally {
				for (const client of clients) client.disconnect()
				if (server !== null) await server.socket.socketInstance.close()
				await serverStorage.close()
			}
		})
	})

	function waitForSocketEvent(socket: ClientSocket, event: 'connect' | 'disconnect'): Promise<void> {
		return withTimeout(
			new Promise<void>((resolve, reject) => {
				socket.once(event, resolve)
				socket.once('connect_error', reject)
			}),
			`Timed out waiting for Socket.IO ${event}`,
		)
	}

	function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
		return Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				setTimeout(() => reject(new Error(message)), 2_000)
			}),
		])
	}
}
