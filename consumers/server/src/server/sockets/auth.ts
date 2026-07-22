import type { IncomingHttpHeaders } from 'node:http2'

import fastifyCookie from '@fastify/cookie'
import { NotAuthenticatedError } from 'equipped/errors'
import { BaseRequestAuthMethod } from 'equipped/server'
import type { AuthUser } from 'equipped/types'

import type { ServerApiClock, ServerApiSecurity } from '../api/context'
import type { ServerCache } from '../cache'
import { resolveSelectedPortfolioAccess } from '../modules/selected-portfolio-access'
import { selectionCookieName } from '../modules/selection-cookie'
import { sessionCookieName } from '../modules/sessions'
import type { ServerStorage } from '../storage/repo'

type SelectedPortfolioSocketAuthContext = {
	serverStorage: ServerStorage
	serverCache: ServerCache
	security: Pick<ServerApiSecurity, 'sessionSigningKey' | 'selectionSigningKey'>
	now: ServerApiClock
}

type SelectedPortfolioSocketIdentity = AuthUser & {
	sessionId: string
	workspaceId: string
	portfolioId: string
	workspaceMemberId: string
}

class SelectedPortfolioSocketAuthMethod extends BaseRequestAuthMethod<SelectedPortfolioSocketIdentity> {
	constructor(private readonly context: SelectedPortfolioSocketAuthContext) {
		super()
	}

	async parse(headers: IncomingHttpHeaders): Promise<SelectedPortfolioSocketIdentity> {
		const cookieHeader = headers.cookie
		if (typeof cookieHeader !== 'string') throw new NotAuthenticatedError()
		const cookies = fastifyCookie.parse(cookieHeader)
		const resolved = await resolveSelectedPortfolioAccess({
			serverStorage: this.context.serverStorage,
			serverCache: this.context.serverCache,
			sessionToken: cookies[sessionCookieName] ?? null,
			selectionToken: cookies[selectionCookieName] ?? null,
			now: this.context.now(),
			sessionSigningKey: this.context.security.sessionSigningKey,
			selectionSigningKey: this.context.security.selectionSigningKey,
		})
		if (!resolved.resolved) throw new NotAuthenticatedError()
		return {
			id: resolved.session.userId,
			sessionId: resolved.session.sessionId,
			workspaceId: resolved.access.workspace.id,
			portfolioId: resolved.access.portfolio.id,
			workspaceMemberId: resolved.access.workspaceMember.id,
		}
	}

	routeSecuritySchemeName(): null {
		return null
	}
}

export function createSelectedPortfolioSocketAuthMethod(context: SelectedPortfolioSocketAuthContext): BaseRequestAuthMethod<AuthUser> {
	return new SelectedPortfolioSocketAuthMethod(context)
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { createTestServerCache } = await import('../testing/server-cache')
	const { createTempServerStorageTestHarness } = await import('../testing/server-storage')
	const { openServerStorage } = await import('../storage/repo')
	const { createUser } = await import('../modules/identities')
	const { createWorkspaceForUser } = await import('../modules/workspace-creation')
	const { createPortfolioRegistryEntry } = await import('../modules/workspaces')
	const { createSession, sessionCookieName } = await import('../modules/sessions')
	const { buildSelectionCookie, selectionCookieName } = await import('../modules/selection-cookie')

	const now = new Date('2026-07-21T22:45:00.000Z')
	const sessionSigningKey = 'socket-auth-session-key'
	const selectionSigningKey = 'socket-auth-selection-key'
	const { cleanupTempServerStorage, createTempServerDataDir } = createTempServerStorageTestHarness('gorchestra-socket-auth-')

	afterEach(cleanupTempServerStorage)

	describe('Selected Portfolio socket authentication', () => {
		it('resolves a minimal selected identity from the existing Session and Selection cookies', async () => {
			const fixture = await createSocketAuthFixture()
			try {
				const method = createSelectedPortfolioSocketAuthMethod(fixture.context)

				expect(await method.parse({ cookie: fixture.cookie })).toEqual({
					id: fixture.user.id,
					sessionId: fixture.session.session.sessionId,
					workspaceId: fixture.workspace.workspace.id,
					portfolioId: fixture.portfolio.id,
					workspaceMemberId: fixture.workspace.workspaceMember.id,
				})
				expect(method.routeSecuritySchemeName()).toBeNull()
			} finally {
				await fixture.serverStorage.close()
			}
		})

		it('rejects a handshake Cookie header without Selection', async () => {
			const fixture = await createSocketAuthFixture()
			try {
				const method = createSelectedPortfolioSocketAuthMethod(fixture.context)

				await expect(method.parse({ cookie: `${sessionCookieName}=${fixture.session.token}` })).rejects.toBeInstanceOf(
					NotAuthenticatedError,
				)
			} finally {
				await fixture.serverStorage.close()
			}
		})
	})

	async function createSocketAuthFixture() {
		const serverStorage = await openServerStorage({ dataDir: await createTempServerDataDir() })
		const serverCache = createTestServerCache()
		const user = await createUser({ serverStorage, now })
		const workspace = await createWorkspaceForUser({ serverStorage, userId: user.id, displayName: 'Workspace', now })
		const portfolio = await createPortfolioRegistryEntry({
			serverStorage,
			workspaceId: workspace.workspace.id,
			displayName: 'Portfolio',
			coreStorageNamespace: 'portfolios/socket-auth',
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
		return {
			serverStorage,
			serverCache,
			user,
			workspace,
			portfolio,
			session,
			selection,
			cookie: `${sessionCookieName}=${session.token}; ${selectionCookieName}=${selection.token}`,
			context: {
				serverStorage,
				serverCache,
				security: { sessionSigningKey, selectionSigningKey },
				now: () => now,
			},
		}
	}
}
