import type { Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import { deliveryResponsePipe, listDeliveriesResponsePipe } from './response-pipes'
import { portfolioRequestCookieSchema, type PortfolioRequestCookies } from './shared'
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
				response: listDeliveriesResponsePipe,
			},
		})(async (req) => listSelectedProjectDeliveries(context, req.cookies, req.params.projectId))
		.get('/projects/:projectId/deliveries/:deliveryId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe, deliveryId: idPipe }),
				response: deliveryResponsePipe,
			},
		})(async (req) => getSelectedProjectDelivery(context, req.cookies, req.params.projectId, req.params.deliveryId))
}

function listSelectedProjectDeliveries(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
): Promise<Queries.ListDeliveries.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const deliveries = await core.queries.listDeliveries({ projectId })
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
