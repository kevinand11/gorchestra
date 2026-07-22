import type { ServerSocketIdentity } from '../composables/core/server-socket'

type ServerSocketSessionState = { authenticated: false } | { authenticated: true; session: { sessionId: string } }

type ServerSocketSelectionState = { selected: false } | { selected: true; workspace: { id: string }; portfolio: { id: string } }

type SelectedRouteAccess = { ready: true } | { ready: false; redirect: '/sign-in' | '/select' }

type ResolveSelectedRouteAccessInput = {
	browser: boolean
	loadSession: () => Promise<ServerSocketSessionState>
	loadSelection: () => Promise<ServerSocketSelectionState>
	connect: (identity: ServerSocketIdentity) => Promise<void>
}

export async function resolveSelectedRouteAccess(input: ResolveSelectedRouteAccessInput): Promise<SelectedRouteAccess> {
	const session = await input.loadSession()
	if (!session.authenticated) return { ready: false, redirect: '/sign-in' }
	const selection = await input.loadSelection()
	if (!selection.selected) return { ready: false, redirect: '/select' }
	if (input.browser) await input.connect(selectedServerSocketIdentity(session, selection))
	return { ready: true }
}

export function selectedServerSocketIdentity(
	session: Extract<ServerSocketSessionState, { authenticated: true }>,
	selection: Extract<ServerSocketSelectionState, { selected: true }>,
): ServerSocketIdentity {
	return {
		sessionId: session.session.sessionId,
		workspaceId: selection.workspace.id,
		portfolioId: selection.portfolio.id,
	}
}

export function selectedServerSocketIdentityOrNull(
	session: ServerSocketSessionState | null,
	selection: ServerSocketSelectionState | null,
): ServerSocketIdentity | null {
	return session?.authenticated === true && selection?.selected === true ? selectedServerSocketIdentity(session, selection) : null
}

export async function runWithServerSocketDisconnected<T>(input: {
	identity: ServerSocketIdentity | null
	disconnect: () => void
	connect: (identity: ServerSocketIdentity) => Promise<void>
	run: () => Promise<T>
}): Promise<T> {
	input.disconnect()
	try {
		return await input.run()
	} catch (error) {
		if (input.identity !== null) await input.connect(input.identity).catch(() => {})
		throw error
	}
}

if (import.meta.vitest) {
	const { describe, expect, it, vi } = import.meta.vitest

	describe('selected route socket readiness', () => {
		it('awaits browser socket readiness after Session and Selection resolve', async () => {
			const calls: string[] = []
			let resolveSocket: () => void = () => {}
			const socketReady = new Promise<void>((resolve) => {
				resolveSocket = resolve
			})
			const access = resolveSelectedRouteAccess({
				browser: true,
				loadSession: vi.fn(() => {
					calls.push('session')
					return Promise.resolve({ authenticated: true as const, session: { sessionId: 'session-1' } })
				}),
				loadSelection: vi.fn(() => {
					calls.push('selection')
					return Promise.resolve({
						selected: true as const,
						workspace: { id: 'workspace-1' },
						portfolio: { id: 'portfolio-1' },
					})
				}),
				connect: vi.fn(async () => {
					calls.push('socket')
					await socketReady
				}),
			})

			await vi.waitFor(() => expect(calls).toEqual(['session', 'selection', 'socket']))
			let resolved = false
			void access.then(() => {
				resolved = true
			})
			await Promise.resolve()
			expect(resolved).toBe(false)
			resolveSocket()

			await expect(access).resolves.toEqual({ ready: true })
		})

		it('keeps SSR limited to REST Session and Selection access', async () => {
			const connect = vi.fn(() => Promise.resolve())

			await expect(
				resolveSelectedRouteAccess({
					browser: false,
					loadSession: () => Promise.resolve({ authenticated: true, session: { sessionId: 'session-1' } }),
					loadSelection: () =>
						Promise.resolve({
							selected: true,
							workspace: { id: 'workspace-1' },
							portfolio: { id: 'portfolio-1' },
						}),
					connect,
				}),
			).resolves.toEqual({ ready: true })
			expect(connect).not.toHaveBeenCalled()
		})

		it('redirects an unauthenticated Session before reading Selection', async () => {
			const loadSelection = vi.fn<() => Promise<ServerSocketSelectionState>>()
			const connect = vi.fn(() => Promise.resolve())

			await expect(
				resolveSelectedRouteAccess({
					browser: true,
					loadSession: () => Promise.resolve({ authenticated: false }),
					loadSelection,
					connect,
				}),
			).resolves.toEqual({ ready: false, redirect: '/sign-in' })
			expect(loadSelection).not.toHaveBeenCalled()
			expect(connect).not.toHaveBeenCalled()
		})

		it('disconnects before credential removal and restores a still-valid identity after failure', async () => {
			const calls: string[] = []
			const originalFailure = new Error('REST failed')
			const identity = { sessionId: 'session-1', workspaceId: 'workspace-1', portfolioId: 'portfolio-1' }

			await expect(
				runWithServerSocketDisconnected({
					identity,
					disconnect: () => calls.push('disconnect'),
					connect: (nextIdentity) => {
						calls.push(`connect:${nextIdentity.portfolioId}`)
						return Promise.resolve()
					},
					run: () => {
						calls.push('remove')
						return Promise.reject(originalFailure)
					},
				}),
			).rejects.toBe(originalFailure)
			expect(calls).toEqual(['disconnect', 'remove', 'connect:portfolio-1'])
		})
	})
}
