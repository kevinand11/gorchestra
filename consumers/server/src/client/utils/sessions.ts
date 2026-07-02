import type { ServerApi } from '../composables/core/server-api'

export type Session = Awaited<ReturnType<ServerApi['getSession']>>
export type Selection = Awaited<ReturnType<ServerApi['getSelection']>>
export type AuthenticatedSession = Extract<Session, { authenticated: true }>
export type SessionRefreshScope = { inFlight: Promise<Session> | null }

type RefreshSessionResponse = Awaited<ReturnType<ServerApi['refreshSession']>>
type SessionServerApi = Pick<ServerApi, 'getSession' | 'refreshSession'>
type SelectionServerApi = Pick<ServerApi, 'getSelection'>

type SessionQueryCache = {
	queryKeys: { session: () => readonly string[] }
	read: <T>(queryKey: readonly string[], initialData: T | (() => T), fetcher: () => Promise<T>) => Promise<T>
	set: <T>(queryKey: readonly string[], data: T) => void
}

type SelectionQueryCache = {
	queryKeys: { selection: () => readonly string[] }
	read: <T>(queryKey: readonly string[], initialData: T | (() => T), fetcher: () => Promise<T>) => Promise<T>
}

type SessionCacheWriter = {
	queryKeys: { session: () => readonly string[] }
	set: <T>(queryKey: readonly string[], data: T) => void
}

const sessionRefreshScopeKey = Symbol('gorchestra.session-refresh-scope')

type NuxtAppWithSessionRefresh = ReturnType<typeof useNuxtApp> & {
	[sessionRefreshScopeKey]?: SessionRefreshScope
}

export async function loadSessionWithRefresh(
	serverApi: SessionServerApi,
	queryCache: SessionQueryCache,
	refreshScope: SessionRefreshScope | null = getBrowserSessionRefreshScope(),
): Promise<Session> {
	const session = await queryCache.read<Session | null>(queryCache.queryKeys.session(), null, () => fetchSession(serverApi))
	if (session === null) throw new Error('Session loader did not resolve a Session')
	return await refreshSessionIfRecommended(session, serverApi, queryCache, refreshScope)
}

export async function loadSelection(serverApi: SelectionServerApi, queryCache: SelectionQueryCache): Promise<Selection> {
	const selection = await queryCache.read<Selection | null>(queryCache.queryKeys.selection(), null, () => fetchSelection(serverApi))
	if (selection === null) throw new Error('Selection loader did not resolve a Selection')
	return selection
}

export async function fetchSession(serverApi: SessionServerApi): Promise<Session> {
	return await serverApi.getSession()
}

export async function fetchSelection(serverApi: SelectionServerApi): Promise<Selection> {
	return await serverApi.getSelection()
}

export async function refreshSessionIfRecommended(
	session: Session,
	serverApi: Pick<ServerApi, 'refreshSession'>,
	queryCache: SessionCacheWriter,
	refreshScope: SessionRefreshScope | null = getBrowserSessionRefreshScope(),
): Promise<Session> {
	if (refreshScope === null || !shouldRefreshSession(session, refreshScope)) return session
	return await getSessionRefresh(refreshScope, serverApi, queryCache)
}

export function shouldRefreshSession(
	session: Session,
	refreshScope: SessionRefreshScope | null = getBrowserSessionRefreshScope(),
): session is AuthenticatedSession {
	return refreshScope !== null && isAuthenticatedSession(session) && session.refreshRecommended
}

function getBrowserSessionRefreshScope(): SessionRefreshScope | null {
	if (typeof window === 'undefined') return null

	const nuxtApp = tryUseNuxtApp()
	if (nuxtApp === null) return null

	const appWithSessionRefresh = nuxtApp as NuxtAppWithSessionRefresh
	appWithSessionRefresh[sessionRefreshScopeKey] ??= createSessionRefreshScope()
	return appWithSessionRefresh[sessionRefreshScopeKey]
}

function createSessionRefreshScope(): SessionRefreshScope {
	return { inFlight: null }
}

function isAuthenticatedSession(session: Session): session is AuthenticatedSession {
	return session.authenticated
}

function getSessionRefresh(
	refreshScope: SessionRefreshScope,
	serverApi: Pick<ServerApi, 'refreshSession'>,
	queryCache: SessionCacheWriter,
): Promise<Session> {
	refreshScope.inFlight ??= createSessionRefresh(refreshScope, serverApi, queryCache)
	return refreshScope.inFlight
}

function createSessionRefresh(
	refreshScope: SessionRefreshScope,
	serverApi: Pick<ServerApi, 'refreshSession'>,
	queryCache: SessionCacheWriter,
): Promise<Session> {
	const refresh = refreshSession(serverApi, queryCache)
	void refresh.finally(() => clearSessionRefresh(refreshScope, refresh))
	return refresh
}

function clearSessionRefresh(refreshScope: SessionRefreshScope, refresh: Promise<Session>): void {
	if (refreshScope.inFlight === refresh) refreshScope.inFlight = null
}

async function refreshSession(serverApi: Pick<ServerApi, 'refreshSession'>, queryCache: SessionCacheWriter): Promise<Session> {
	const session = authenticatedSessionFromRefresh(await serverApi.refreshSession())
	queryCache.set(queryCache.queryKeys.session(), session)
	return session
}

function authenticatedSessionFromRefresh(session: RefreshSessionResponse): AuthenticatedSession {
	return { authenticated: true, session, refreshRecommended: false }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('session loading', () => {
		it('loads uncached Sessions through the Query Cache', async () => {
			const session = authenticatedSession({ refreshRecommended: false })
			const serverApi = testServerApi({ session })
			const queryCache = testQueryCache()

			await expect(loadSessionWithRefresh(serverApi, queryCache, null)).resolves.toEqual(session)
			expect(serverApi.getSessionCalls).toBe(1)
			expect(queryCache.session).toEqual(session)
		})

		it('refreshes cached authenticated Sessions when recommended', async () => {
			const cached = authenticatedSession({ sessionId: 'session-old', refreshRecommended: true })
			const refreshed = sessionRecord({ sessionId: 'session-new' })
			const serverApi = testServerApi({ session: cached, refreshedSession: refreshed })
			const queryCache = testQueryCache({ session: cached })

			await expect(loadSessionWithRefresh(serverApi, queryCache, createSessionRefreshScope())).resolves.toEqual(
				authenticatedSession({ session: refreshed, refreshRecommended: false }),
			)
			expect(serverApi.getSessionCalls).toBe(0)
			expect(serverApi.refreshSessionCalls).toBe(1)
			expect(queryCache.session).toEqual(authenticatedSession({ session: refreshed, refreshRecommended: false }))
		})

		it('does not refresh without a browser refresh scope', async () => {
			const session = authenticatedSession({ refreshRecommended: true })
			const serverApi = testServerApi({ session })
			const queryCache = testQueryCache({ session })

			await expect(loadSessionWithRefresh(serverApi, queryCache, null)).resolves.toEqual(session)
			expect(serverApi.refreshSessionCalls).toBe(0)
		})

		it('does not refresh unauthenticated Sessions', async () => {
			const session: Session = { authenticated: false, reason: 'missing-token' }
			const serverApi = testServerApi({ session })
			const queryCache = testQueryCache({ session })

			await expect(loadSessionWithRefresh(serverApi, queryCache, createSessionRefreshScope())).resolves.toEqual(session)
			expect(serverApi.refreshSessionCalls).toBe(0)
		})

		it('dedupes concurrent refreshes through the refresh scope', async () => {
			const session = authenticatedSession({ refreshRecommended: true })
			const refreshed = sessionRecord({ sessionId: 'session-new' })
			let resolveRefresh: (session: RefreshSessionResponse) => void = () => {}
			const refresh = new Promise<RefreshSessionResponse>((resolve) => {
				resolveRefresh = resolve
			})
			const serverApi = testServerApi({ session, refreshSession: () => refresh })
			const queryCache = testQueryCache({ session })
			const refreshScope = createSessionRefreshScope()

			const first = loadSessionWithRefresh(serverApi, queryCache, refreshScope)
			const second = loadSessionWithRefresh(serverApi, queryCache, refreshScope)
			resolveRefresh(refreshed)

			await expect(Promise.all([first, second])).resolves.toEqual([
				authenticatedSession({ session: refreshed, refreshRecommended: false }),
				authenticatedSession({ session: refreshed, refreshRecommended: false }),
			])
			expect(serverApi.refreshSessionCalls).toBe(1)
			expect(refreshScope.inFlight).toBeNull()
		})
	})

	type TestQueryCacheOptions = {
		session?: Session
		selection?: Selection
	}

	function testQueryCache(options: TestQueryCacheOptions = {}) {
		let session = options.session
		let selection = options.selection
		return {
			get session() {
				return session
			},
			queryKeys: {
				session: () => ['session'] as const,
				selection: () => ['selection'] as const,
			},
			async read<T>(key: readonly string[], _initialData: T | (() => T), fetcher: () => Promise<T>): Promise<T> {
				if (key[0] === 'session') {
					if (session !== undefined) return session as T
					session = (await fetcher()) as Session
					return session as T
				}
				if (selection !== undefined) return selection as T
				selection = (await fetcher()) as Selection
				return selection as T
			},
			set<T>(key: readonly string[], value: T): void {
				if (key[0] === 'session') session = value as Session
				else selection = value as Selection
			},
		}
	}

	type TestServerApiOptions = {
		session: Session
		refreshedSession?: RefreshSessionResponse
		refreshSession?: () => Promise<RefreshSessionResponse>
	}

	function testServerApi(options: TestServerApiOptions) {
		let getSessionCalls = 0
		let refreshSessionCalls = 0
		const api = {
			get getSessionCalls() {
				return getSessionCalls
			},
			get refreshSessionCalls() {
				return refreshSessionCalls
			},
			getSession(): Promise<Session> {
				getSessionCalls += 1
				return Promise.resolve(options.session)
			},
			async refreshSession(): Promise<RefreshSessionResponse> {
				refreshSessionCalls += 1
				return options.refreshSession === undefined
					? (options.refreshedSession ?? sessionRecord({ sessionId: 'session-refreshed' }))
					: await options.refreshSession()
			},
		}
		return api
	}

	function authenticatedSession(input: {
		session?: RefreshSessionResponse
		sessionId?: string
		refreshRecommended: boolean
	}): AuthenticatedSession {
		return {
			authenticated: true,
			refreshRecommended: input.refreshRecommended,
			session: input.session ?? sessionRecord({ sessionId: input.sessionId ?? 'session-1' }),
		}
	}

	function sessionRecord(input: { sessionId: string }): RefreshSessionResponse {
		return {
			userId: 'user-1',
			email: 'person@example.com',
			sessionId: input.sessionId,
			issuedAt: '2026-07-01T00:00:00.000Z',
			expiresAt: '2026-07-02T00:00:00.000Z',
		}
	}
}
