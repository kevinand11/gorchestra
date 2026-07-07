import { Router } from 'equipped/server'
import { v } from 'valleyed'

import { createPortfolioForWorkspace } from '../../modules/portfolio-creation'
import { createWorkspaceForUser } from '../../modules/workspace-creation'
import { listAccessibleWorkspaces, validateWorkspaceOwnerAccess } from '../../modules/workspaces'
import type { ServerApiContext } from '../context'
import { throwNotAuthorized, throwSessionAuthenticationError } from '../errors'
import {
	idPipe,
	portfolioRegistryEntryResponseSchema,
	workspaceMemberResponseSchema,
	workspaceOwnerRoleResponseSchema,
	workspaceResponseSchema,
} from '../schemas'
import { authenticateApiSession, getSessionToken, sessionCookieSchema } from '../session'

const workspaceCreationBodySchema = v.object({ displayName: displayNamePipe() })
const portfolioCreationBodySchema = v.object({ displayName: displayNamePipe() })
const workspaceParamsSchema = v.object({ workspaceId: idPipe })

const accessibleWorkspaceResponseSchema = v.merge(
	workspaceResponseSchema,
	v.object({
		member: workspaceMemberResponseSchema,
		ownerRole: v.nullable(workspaceOwnerRoleResponseSchema),
		portfolios: v.array(portfolioRegistryEntryResponseSchema),
	}),
)

export function createWorkspaceApiRouter(context: ServerApiContext) {
	return new Router({ path: '/workspaces' })
		.get('/', {
			schema: {
				cookies: sessionCookieSchema,
				response: v.array(accessibleWorkspaceResponseSchema),
			},
		})(async (req) => {
			const authentication = await authenticateApiSession(context, getSessionToken(req.cookies))
			if (!authentication.authenticated) throwSessionAuthenticationError(authentication.reason)

			return await listAccessibleWorkspaces({
				serverStorage: context.serverStorage,
				userId: authentication.session.userId,
			})
		})
		.post('/', {
			schema: {
				body: workspaceCreationBodySchema,
				cookies: sessionCookieSchema,
				response: workspaceResponseSchema,
			},
		})(async (req) => {
			const authentication = await authenticateApiSession(context, getSessionToken(req.cookies))
			if (!authentication.authenticated) throwSessionAuthenticationError(authentication.reason)

			const created = await createWorkspaceForUser({
				serverStorage: context.serverStorage,
				userId: authentication.session.userId,
				displayName: req.body.displayName,
				now: context.now(),
			})
			return created.workspace
		})
		.post('/:workspaceId/portfolios', {
			schema: {
				params: workspaceParamsSchema,
				body: portfolioCreationBodySchema,
				cookies: sessionCookieSchema,
				response: portfolioRegistryEntryResponseSchema,
			},
		})(async (req) => {
		const authentication = await authenticateApiSession(context, getSessionToken(req.cookies))
		if (!authentication.authenticated) throwSessionAuthenticationError(authentication.reason)

		const access = await validateWorkspaceOwnerAccess({
			serverStorage: context.serverStorage,
			userId: authentication.session.userId,
			workspaceId: req.params.workspaceId,
		})
		if (!access.authorized) throwNotAuthorized('Workspace Owner authority is required to create Portfolios for this Workspace')

		return await createPortfolioForWorkspace({
			serverStorage: context.serverStorage,
			workspaceId: access.workspace.id,
			displayName: req.body.displayName,
			corePortfolioStorage: context.corePortfolioStorage,
			now: context.now(),
			secretEncryptionKey: context.security.secretEncryptionKey,
		})
	})
}

function displayNamePipe() {
	return v.string().pipe(v.asTrimmed(), v.min<string>(1))
}
