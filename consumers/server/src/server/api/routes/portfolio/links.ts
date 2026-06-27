import { Domain } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import {
	createLinkRequestSchema,
	portfolioRequestCookieSchema,
	setLinkArchiveStateRequestSchema,
	type CreateLinkRequest,
	type PortfolioRequestCookies,
	type SetLinkArchiveStateRequest,
} from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { idPipe } from '../../schemas'

export function createLinksApiRouter(context: ServerApiContext) {
	return new Router()
		.post('/links', {
			schema: { cookies: portfolioRequestCookieSchema, body: createLinkRequestSchema, response: Domain.Graph.linkPipe },
		})(async (req) => createSelectedPortfolioLink(context, req.cookies, req.body))
		.post('/links/:linkId/archive-state', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ linkId: idPipe }),
				body: setLinkArchiveStateRequestSchema,
				response: Domain.Graph.linkPipe,
			},
		})(async (req) => setSelectedPortfolioLinkArchiveState(context, req.cookies, req.params.linkId, req.body))
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

function setSelectedPortfolioLinkArchiveState(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	linkId: string,
	input: SetLinkArchiveStateRequest,
): Promise<Domain.Graph.Link> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const link = await core.commands.setLinkArchiveState(
			{ linkId, archived: input.archived },
			{
				actor: { type: 'workspace-member', id: workspaceMember.id },
				correlationId: null,
			},
		)
		return link.ok ? link.value : throwCoreOperationError(link.error)
	})
}
