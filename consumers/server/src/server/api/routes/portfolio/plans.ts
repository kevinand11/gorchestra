import { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import {
	createPlanRequestSchema,
	portfolioRequestCookieSchema,
	type CreatePlanRequest,
	type PaginatedQuery,
	type PortfolioRequestCookies,
} from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { coreIdPipe } from '../../schemas'

export function createPlansApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/projects/:projectId/plans', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: coreIdPipe }),
				query: Domain.Commons.paginatedQueryInputPipe,
				response: Queries.ListPlans.resultPipe,
			},
		})(async (req) => listSelectedProjectPlans(context, req.cookies, req.params.projectId, req.query))
		.post('/projects/:projectId/plans', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: coreIdPipe }),
				body: createPlanRequestSchema,
				response: Domain.Plan.planPipe,
			},
		})(async (req) => createSelectedProjectPlan(context, req.cookies, req.params.projectId, req.body))
		.get('/projects/:projectId/plans/:planId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: coreIdPipe, planId: coreIdPipe }),
				response: Queries.GetPlan.resultPipe,
			},
		})(async (req) => getSelectedProjectPlan(context, req.cookies, req.params.projectId, req.params.planId))
		.post('/projects/:projectId/plans/:planId/close', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: coreIdPipe, planId: coreIdPipe }),
				response: Domain.Plan.planPipe,
			},
		})(async (req) => closeSelectedProjectPlan(context, req.cookies, req.params.projectId, req.params.planId))
}

function listSelectedProjectPlans(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
	query: PaginatedQuery,
): Promise<Queries.ListPlans.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const plans = await core.queries.listPlans({ projectId, ...query })
		return plans.ok ? plans.value : throwCoreOperationError(plans.error)
	})
}

function createSelectedProjectPlan(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
	input: CreatePlanRequest,
): Promise<Domain.Plan.Plan> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const plan = await core.commands.createPlan(
			{ projectId, title: input.title, initialMessage: input.initialMessage, agentRunProfileId: input.agentRunProfileId },
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

function closeSelectedProjectPlan(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
	planId: string,
): Promise<Domain.Plan.Plan> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const plan = await core.commands.closePlan(
			{ projectId, planId },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return plan.ok ? plan.value : throwCoreOperationError(plan.error)
	})
}
