import { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v, type PipeOutput } from 'valleyed'

import {
	portfolioRequestCookieSchema,
	sendAgentRunMessageRequestSchema,
	type PortfolioRequestCookies,
	type SendAgentRunMessageRequest,
} from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { idPipe } from '../../schemas'

const agentRunEventsQuerySchema = v.object({
	afterCursor: v.optional(Domain.AgentRun.agentRunEventCursorPipe),
	limit: v.optional(v.fromJson(v.number())),
})
type AgentRunEventsQuery = PipeOutput<typeof agentRunEventsQuerySchema>

export function createAgentRunsApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/agent-runs/:agentRunId/events', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ agentRunId: idPipe }),
				query: agentRunEventsQuerySchema,
				response: Queries.GetAgentRunEvents.resultPipe,
			},
		})(async (req) => getSelectedPortfolioAgentRunEvents(context, req.cookies, req.params.agentRunId, req.query))
		.post('/agent-runs/:agentRunId/messages', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ agentRunId: idPipe }),
				body: sendAgentRunMessageRequestSchema,
				response: Domain.AgentRun.agentRunEventPipe,
			},
		})(async (req) => sendSelectedPortfolioAgentRunMessage(context, req.cookies, req.params.agentRunId, req.body))
}

function getSelectedPortfolioAgentRunEvents(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	agentRunId: string,
	query: AgentRunEventsQuery,
): Promise<Queries.GetAgentRunEvents.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const events = await core.queries.getAgentRunEvents({ agentRunId, afterCursor: query.afterCursor, limit: query.limit })
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
			{ agentRunId, content: input.content },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return event.ok ? event.value : throwCoreOperationError(event.error)
	})
}
