import { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'

import {
	portfolioRequestCookieSchema,
	setPortfolioConfigRequestSchema,
	type PortfolioRequestCookies,
	type SetPortfolioConfigRequest,
} from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'

export function createPortfolioConfigApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/config', {
			schema: { cookies: portfolioRequestCookieSchema, response: Queries.GetPortfolioConfig.resultPipe },
		})(async (req) => getSelectedPortfolioConfig(context, req.cookies))
		.put('/config', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				body: setPortfolioConfigRequestSchema,
				response: Domain.Config.portfolioConfigRecordPipe,
			},
		})(async (req) => setSelectedPortfolioConfig(context, req.cookies, req.body))
}

function getSelectedPortfolioConfig(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
): Promise<Queries.GetPortfolioConfig.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const config = await core.queries.getPortfolioConfig({})
		return config.ok ? config.value : throwCoreOperationError(config.error)
	})
}

function setSelectedPortfolioConfig(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	input: SetPortfolioConfigRequest,
): Promise<Domain.Config.PortfolioConfigRecord> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const config = await core.commands.setPortfolioConfig(input, {
			actor: { type: 'workspace-member', id: workspaceMember.id },
			correlationId: null,
		})
		return config.ok ? config.value : throwCoreOperationError(config.error)
	})
}
