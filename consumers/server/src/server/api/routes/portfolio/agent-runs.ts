import { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import {
	agentRunRuntimeRequirementOverrideRequestSchema,
	portfolioRequestCookieSchema,
	sendAgentRunMessageRequestSchema,
	type AgentRunRuntimeRequirementOverrideRequest,
	type PaginatedQuery,
	type PortfolioRequestCookies,
	type SendAgentRunMessageRequest,
} from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { coreIdPipe } from '../../schemas'

const agentRunEventsQuerySchema = Domain.Commons.paginatedQueryInputPipe

export function createAgentRunsApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/agent-runs/:agentRunId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ agentRunId: coreIdPipe }),
				response: Queries.GetAgentRun.resultPipe,
			},
		})(async (req) => getSelectedPortfolioAgentRun(context, req.cookies, req.params.agentRunId))
		.get('/agent-runs/:agentRunId/events', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ agentRunId: coreIdPipe }),
				query: agentRunEventsQuerySchema,
				response: Queries.ListAgentRunEvents.resultPipe,
			},
		})(async (req) => getSelectedPortfolioAgentRunEvents(context, req.cookies, req.params.agentRunId, req.query))
		.post('/agent-runs/:agentRunId/messages', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ agentRunId: coreIdPipe }),
				body: sendAgentRunMessageRequestSchema,
				response: Domain.AgentRun.agentRunEventPipe,
			},
		})(async (req) => sendSelectedPortfolioAgentRunMessage(context, req.cookies, req.params.agentRunId, req.body))
		.post('/agent-runs/:agentRunId/runtime-requirement-overrides', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ agentRunId: coreIdPipe }),
				body: agentRunRuntimeRequirementOverrideRequestSchema,
				response: Domain.AgentRun.agentRunEventPipe,
			},
		})(async (req) => addSelectedPortfolioAgentRunRuntimeRequirementOverride(context, req.cookies, req.params.agentRunId, req.body))
}

function getSelectedPortfolioAgentRun(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	agentRunId: string,
): Promise<Queries.GetAgentRun.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const agentRun = await core.queries.getAgentRun({ agentRunId })
		return agentRun.ok ? agentRun.value : throwCoreOperationError(agentRun.error)
	})
}

function getSelectedPortfolioAgentRunEvents(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	agentRunId: string,
	query: PaginatedQuery,
): Promise<Queries.ListAgentRunEvents.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const events = await core.queries.listAgentRunEvents({ agentRunId, ...query })
		return events.ok ? events.value : throwCoreOperationError(events.error)
	})
}

function sendSelectedPortfolioAgentRunMessage(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	agentRunId: string,
	input: SendAgentRunMessageRequest,
): Promise<Domain.AgentRun.AgentRunEvent> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const event = await core.commands.sendAgentRunMessage(
			{ agentRunId, parts: input.parts },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return event.ok ? event.value : throwCoreOperationError(event.error)
	})
}

function addSelectedPortfolioAgentRunRuntimeRequirementOverride(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	agentRunId: string,
	input: AgentRunRuntimeRequirementOverrideRequest,
): Promise<Domain.AgentRun.AgentRunEvent> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const event = await core.commands.addAgentRunRuntimeRequirementOverride(
			{ agentRunId, requirements: input.requirements },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return event.ok ? event.value : throwCoreOperationError(event.error)
	})
}
