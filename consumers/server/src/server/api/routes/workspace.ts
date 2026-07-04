import { Router } from 'equipped/server'
import { v } from 'valleyed'

import { buildSelectionCookie } from '../../modules/selection-cookie'
import { provisionWorkspaceWithDefaultPortfolio } from '../../modules/workspace-provisioning'
import { listAccessibleWorkspacePortfolios } from '../../modules/workspaces'
import type { ServerApiContext } from '../context'
import { throwNotAuthorized, throwSessionAuthenticationError } from '../errors'
import { moduleCookiesToResponseCookies } from '../http'
import {
	portfolioRegistryEntryResponseSchema,
	selectedPortfolioResponseSchema,
	selectionResponseCookieSchema,
	workspaceMemberResponseSchema,
	workspaceOwnerRoleResponseSchema,
	workspaceResponseSchema,
} from '../schemas'
import { authenticateApiSession, getSessionToken, sessionCookieSchema } from '../session'

const provisionDefaultWorkspaceBodySchema = v.object({
	workspaceDisplayName: displayNamePipe(),
	portfolioDisplayName: displayNamePipe(),
})

export function createWorkspaceApiRouter(context: ServerApiContext) {
	return new Router({ path: '/workspaces' })
		.get('/portfolios', {
			schema: {
				cookies: sessionCookieSchema,
				response: v.array(
					v.object({
						workspace: workspaceResponseSchema,
						workspaceMember: workspaceMemberResponseSchema,
						portfolio: portfolioRegistryEntryResponseSchema,
						activeWorkspaceOwnerRole: v.nullable(workspaceOwnerRoleResponseSchema),
					}),
				),
			},
		})(async (req) => {
			const authentication = await authenticateApiSession(context, getSessionToken(req.cookies))
			if (!authentication.authenticated) throwSessionAuthenticationError(authentication.reason)

			return await listAccessibleWorkspacePortfolios({
				serverStorage: context.serverStorage,
				userId: authentication.session.userId,
			})
		})
		.post('/provision-default', {
			schema: {
				body: provisionDefaultWorkspaceBodySchema,
				cookies: sessionCookieSchema,
				response: v.object({
					workspace: workspaceResponseSchema,
					workspaceMember: workspaceMemberResponseSchema,
					workspaceOwnerRole: workspaceOwnerRoleResponseSchema,
					portfolio: portfolioRegistryEntryResponseSchema,
					selection: selectedPortfolioResponseSchema,
				}),
				responseCookies: selectionResponseCookieSchema,
			},
		})(async (req) => {
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
			corePortfolioStorage: context.corePortfolioStorage,
			now,
			secretEncryptionKey: context.security.secretEncryptionKey,
		})
		const selection = buildSelectionCookie({
			workspaceId: provisioned.workspace.id,
			portfolioId: provisioned.portfolio.id,
			now,
			signingKey: context.security.selectionSigningKey,
		})
		return req.res({
			body: { ...provisioned, selection: selection.selection },
			cookies: moduleCookiesToResponseCookies(selection.cookie),
		})
	})
}

function displayNamePipe() {
	return v.string().pipe(v.asTrimmed(), v.min<string>(1))
}
