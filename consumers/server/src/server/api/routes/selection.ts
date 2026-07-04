import { Router, StatusCodes } from 'equipped/server'
import { v } from 'valleyed'

import { resolveSelectionAccess, validateWorkspacePortfolioAccess } from '../../modules/selection-access'
import { buildDeleteSelectionCookie, buildSelectionCookie, selectionCookieName } from '../../modules/selection-cookie'
import type { ServerApiContext } from '../context'
import { throwSelectionAccessError, throwSessionAuthenticationError } from '../errors'
import { moduleCookiesToResponseCookies, optionalCookiePipe } from '../http'
import {
	noContentResponseSchema,
	portfolioRegistryEntryResponseSchema,
	selectedPortfolioResponseSchema,
	selectionResponseCookieSchema,
	workspaceMemberResponseSchema,
	workspaceOwnerRoleResponseSchema,
	workspaceResponseSchema,
} from '../schemas'
import { authenticateApiSession, getSessionToken, sessionCookieSchema } from '../session'

const selectionCookieSchema = optionalCookiePipe(selectionCookieName)
const selectionRequestCookieSchema = v.merge(sessionCookieSchema, selectionCookieSchema)
const setSelectionBodySchema = v.object({ workspaceId: requestStringPipe(), portfolioId: requestStringPipe() })
const selectionAccessResponseSchema = v.or([
	v.object({
		selected: v.is(true as const),
		selection: selectedPortfolioResponseSchema,
		workspace: workspaceResponseSchema,
		workspaceMember: workspaceMemberResponseSchema,
		portfolio: portfolioRegistryEntryResponseSchema,
		activeWorkspaceOwnerRole: v.nullable(workspaceOwnerRoleResponseSchema),
	}),
	v.object({
		selected: v.is(false as const),
		reason: v.in([
			'missing-token',
			'invalid-token',
			'expired',
			'user-not-found',
			'workspace-not-found',
			'not-active-member',
			'portfolio-not-found',
		] as const),
	}),
])

export function createSelectionApiRouter(context: ServerApiContext) {
	return new Router({ path: '/selection' })
		.get('/', { schema: { cookies: selectionRequestCookieSchema, response: selectionAccessResponseSchema } })(async (req) => {
			const authentication = await authenticateApiSession(context, getSessionToken(req.cookies))
			if (!authentication.authenticated) throwSessionAuthenticationError(authentication.reason)

			return await resolveSelectionAccess({
				serverStorage: context.serverStorage,
				userId: authentication.session.userId,
				selectionToken: req.cookies[selectionCookieName] ?? null,
				now: context.now(),
				signingKey: context.security.selectionSigningKey,
			})
		})
		.post('/', {
			schema: {
				body: setSelectionBodySchema,
				cookies: sessionCookieSchema,
				response: selectionAccessResponseSchema,
				responseCookies: selectionResponseCookieSchema,
			},
		})(async (req) => {
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
				signingKey: context.security.selectionSigningKey,
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
		.delete('/', {
			schema: {
				cookies: sessionCookieSchema,
				response: noContentResponseSchema,
				responseCookies: selectionResponseCookieSchema,
				defaultStatusCode: StatusCodes.NoContent,
			},
		})(async (req) => {
		const authentication = await authenticateApiSession(context, getSessionToken(req.cookies))
		if (!authentication.authenticated) throwSessionAuthenticationError(authentication.reason)

		return req.res({
			status: StatusCodes.NoContent,
			body: undefined,
			cookies: moduleCookiesToResponseCookies(buildDeleteSelectionCookie()),
		})
	})
}

function requestStringPipe() {
	return v.string().pipe(v.asTrimmed(), v.min<string>(1))
}
