import type { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import { listPlansResponsePipe, planResponsePipe } from './response-pipes'
import { createPlanRequestSchema, portfolioRequestCookieSchema, type CreatePlanRequest, type PortfolioRequestCookies } from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { idPipe } from '../../schemas'

export function createPlansApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/projects/:projectId/plans', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe }),
				response: listPlansResponsePipe,
			},
		})(async (req) => listSelectedProjectPlans(context, req.cookies, req.params.projectId))
		.post('/projects/:projectId/plans', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe }),
				body: createPlanRequestSchema,
				response: planResponsePipe,
			},
		})(async (req) => createSelectedProjectPlan(context, req.cookies, req.params.projectId, req.body))
		.get('/projects/:projectId/plans/:planId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe, planId: idPipe }),
				response: planResponsePipe,
			},
		})(async (req) => getSelectedProjectPlan(context, req.cookies, req.params.projectId, req.params.planId))
}

function listSelectedProjectPlans(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
): Promise<Queries.ListPlans.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const plans = await core.queries.listPlans({ projectId })
		return plans.ok ? plans.value : throwCoreOperationError(plans.error)
	})
}

function createSelectedProjectPlan(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
	input: CreatePlanRequest,
): Promise<Domain.Plan.PlanWithPlanningAgentRun> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const plan = await core.commands.createPlan(
			{ projectId, title: input.title, config: null },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return plan.ok ? plan.value : throwCoreOperationError(plan.error)
	})
}

function getSelectedProjectPlan(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
	planId: string,
): Promise<Queries.GetPlan.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const plan = await core.queries.getPlan({ projectId, planId })
		return plan.ok ? plan.value : throwCoreOperationError(plan.error)
	})
}
