import { Domain } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import { createLinkRequestSchema, portfolioRequestCookieSchema, type CreateLinkRequest, type PortfolioRequestCookies } from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { idPipe } from '../../schemas'

export function createLinksApiRouter(context: ServerApiContext) {
	return new Router()
		.post('/links', {
			schema: { cookies: portfolioRequestCookieSchema, body: createLinkRequestSchema, response: Domain.Graph.linkPipe },
		})(async (req) => createSelectedPortfolioLink(context, req.cookies, req.body))
		.post('/links/:linkId/archive', {
			schema: { cookies: portfolioRequestCookieSchema, params: v.object({ linkId: idPipe }), response: Domain.Graph.linkPipe },
		})(async (req) => archiveSelectedPortfolioLink(context, req.cookies, req.params.linkId))
}

function createSelectedPortfolioLink(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	input: CreateLinkRequest,
): Promise<Domain.Graph.Link> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const link = await core.commands.createLink(input, {
			actor: { type: 'workspace-member', id: workspaceMember.id },
			correlationId: null,
		})
		return link.ok ? link.value : throwCoreOperationError(link.error)
	})
}

function archiveSelectedPortfolioLink(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	linkId: string,
): Promise<Domain.Graph.Link> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const link = await core.commands.archiveLink(
			{ linkId },
			{
				actor: { type: 'workspace-member', id: workspaceMember.id },
				correlationId: null,
			},
		)
		return link.ok ? link.value : throwCoreOperationError(link.error)
	})
}
