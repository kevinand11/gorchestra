import { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import { portfolioRequestCookieSchema, type PaginatedQuery, type PortfolioRequestCookies } from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { idPipe } from '../../schemas'

export function createDeliveriesApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/projects/:projectId/deliveries', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe }),
				query: Domain.Commons.paginatedQueryInputPipe,
				response: Queries.ListDeliveries.resultPipe,
			},
		})(async (req) => listSelectedProjectDeliveries(context, req.cookies, req.params.projectId, req.query))
		.get('/projects/:projectId/deliveries/:deliveryId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe, deliveryId: idPipe }),
				response: Queries.GetDelivery.resultPipe,
			},
		})(async (req) => getSelectedProjectDelivery(context, req.cookies, req.params.projectId, req.params.deliveryId))
}

function listSelectedProjectDeliveries(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
	query: PaginatedQuery,
): Promise<Queries.ListDeliveries.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const deliveries = await core.queries.listDeliveries({ projectId, ...query })
		return deliveries.ok ? deliveries.value : throwCoreOperationError(deliveries.error)
	})
}

function getSelectedProjectDelivery(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
	deliveryId: string,
): Promise<Queries.GetDelivery.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const delivery = await core.queries.getDelivery({ projectId, deliveryId })
		return delivery.ok ? delivery.value : throwCoreOperationError(delivery.error)
	})
}
