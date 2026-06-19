import { Router, type RouteDef } from 'equipped/server'
import { v } from 'valleyed'

import type { ServerApiContext } from './context'
import { throwNotAuthorized, throwSessionAuthenticationError } from './errors'
import { jsonObjectPipe, moduleCookiesToResponseCookies } from './http'
import { authenticateApiSession, getSessionToken, sessionCookieSchema } from './session'
import { buildSelectionCookie } from '../modules/selection-cookie'
import { provisionWorkspaceWithDefaultPortfolio } from '../modules/workspace-provisioning'
import { listAccessibleWorkspacePortfolios } from '../modules/workspaces'

const provisionDefaultWorkspaceBodySchema = jsonObjectPipe({
	workspaceDisplayName: displayNamePipe(),
	portfolioDisplayName: displayNamePipe(),
})

export function createWorkspaceApiRouter(context: ServerApiContext): Router<RouteDef> {
	const router = new Router({ path: '/api' })

	router.get('workspace-portfolios', { schema: { cookies: sessionCookieSchema } })(async (req) => {
		const authentication = await authenticateApiSession(context, getSessionToken(req.cookies))
		if (!authentication.authenticated) throwSessionAuthenticationError(authentication.reason)

		return req.res({
			body: {
				workspacePortfolios: await listAccessibleWorkspacePortfolios({
					serverStorage: context.serverStorage,
					userId: authentication.session.userId,
				}),
			},
		})
	})

	router.post('workspaces/provision-default', { schema: { body: provisionDefaultWorkspaceBodySchema, cookies: sessionCookieSchema } })(
		async (req) => {
			const authentication = await authenticateApiSession(context, getSessionToken(req.cookies))
			if (!authentication.authenticated) throwSessionAuthenticationError(authentication.reason)

			const existingAccess = await listAccessibleWorkspacePortfolios({
				serverStorage: context.serverStorage,
				userId: authentication.session.userId,
			})
			if (existingAccess.length > 0)
				throwNotAuthorized('Workspace Provisioning is only available when no Workspace and Portfolio can be selected')

			const now = context.now()
			const provisioned = await provisionWorkspaceWithDefaultPortfolio({
				serverStorage: context.serverStorage,
				userId: authentication.session.userId,
				workspaceDisplayName: req.body.workspaceDisplayName,
				portfolioDisplayName: req.body.portfolioDisplayName,
				dataDir: context.dataDir,
				now,
			})
			const selection = buildSelectionCookie({
				workspaceId: provisioned.workspace.id,
				portfolioId: provisioned.portfolio.id,
				now,
				signingKey: context.selectionSigningKey,
			})
			return req.res({
				body: { provisioned: true, ...provisioned, selection: selection.selection },
				cookies: moduleCookiesToResponseCookies(selection.cookie),
			})
		},
	)

	return router
}

function displayNamePipe() {
	return v.string().pipe(v.asTrimmed(), v.min<string>(1))
}
