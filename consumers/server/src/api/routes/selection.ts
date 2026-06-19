import { Router, type RouteDef } from 'equipped/server'
import { v } from 'valleyed'

import { resolveSelectionAccess, validateWorkspacePortfolioAccess } from '../../modules/selection-access'
import { buildDeleteSelectionCookie, buildSelectionCookie, selectionCookieName } from '../../modules/selection-cookie'
import type { ServerApiContext } from '../context'
import { throwSelectionAccessError, throwSessionAuthenticationError } from '../errors'
import { jsonObjectPipe, moduleCookiesToResponseCookies, optionalCookiePipe } from '../http'
import { authenticateApiSession, getSessionToken, sessionCookieSchema } from '../session'

const selectionCookieSchema = optionalCookiePipe(selectionCookieName)
const selectionRequestCookieSchema = v.merge(sessionCookieSchema, selectionCookieSchema)
const setSelectionBodySchema = jsonObjectPipe({ workspaceId: nonEmptyStringPipe(), portfolioId: nonEmptyStringPipe() })

export function createSelectionApiRouter(context: ServerApiContext): Router<RouteDef> {
	const router = new Router({ path: '/selection' })

	router.get('/', { schema: { cookies: selectionRequestCookieSchema } })(async (req) => {
		const authentication = await authenticateApiSession(context, getSessionToken(req.cookies))
		if (!authentication.authenticated) throwSessionAuthenticationError(authentication.reason)

		return req.res({
			body: await resolveSelectionAccess({
				serverStorage: context.serverStorage,
				userId: authentication.session.userId,
				selectionToken: req.cookies[selectionCookieName] ?? null,
				now: context.now(),
				signingKey: context.selectionSigningKey,
			}),
		})
	})

	router.post('/', { schema: { body: setSelectionBodySchema, cookies: sessionCookieSchema } })(async (req) => {
		const authentication = await authenticateApiSession(context, getSessionToken(req.cookies))
		if (!authentication.authenticated) throwSessionAuthenticationError(authentication.reason)

		const access = await validateWorkspacePortfolioAccess({
			serverStorage: context.serverStorage,
			userId: authentication.session.userId,
			selection: req.body,
		})
		if (!access.accessible) throwSelectionAccessError(access.reason)

		const built = buildSelectionCookie({
			workspaceId: access.workspace.id,
			portfolioId: access.portfolio.id,
			now: context.now(),
			signingKey: context.selectionSigningKey,
		})
		return req.res({
			body: {
				selected: true,
				selection: built.selection,
				workspace: access.workspace,
				workspaceMember: access.workspaceMember,
				portfolio: access.portfolio,
				activeWorkspaceOwnerRole: access.activeWorkspaceOwnerRole,
			},
			cookies: moduleCookiesToResponseCookies(built.cookie),
		})
	})

	router.post('/clear', { schema: { cookies: sessionCookieSchema } })(async (req) => {
		const authentication = await authenticateApiSession(context, getSessionToken(req.cookies))
		if (!authentication.authenticated) throwSessionAuthenticationError(authentication.reason)

		return req.res({
			body: { selected: false, reason: 'cleared' },
			cookies: moduleCookiesToResponseCookies(buildDeleteSelectionCookie()),
		})
	})

	return router
}

function nonEmptyStringPipe() {
	return v.string().pipe(v.asTrimmed(), v.min<string>(1))
}
