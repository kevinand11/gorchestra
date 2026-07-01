import { Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v, type PipeOutput } from 'valleyed'

import { portfolioRequestCookieSchema, type PortfolioRequestCookies } from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { idPipe } from '../../schemas'

const agentRunEventsQuerySchema = v.object({
	afterSequence: v.optional(v.fromJson(v.number())),
	limit: v.optional(v.fromJson(v.number())),
})
type AgentRunEventsQuery = PipeOutput<typeof agentRunEventsQuerySchema>

export function createAgentRunsApiRouter(context: ServerApiContext) {
	return new Router().get('/agent-runs/:agentRunId/events', {
		schema: {
			cookies: portfolioRequestCookieSchema,
			params: v.object({ agentRunId: idPipe }),
			query: agentRunEventsQuerySchema,
			response: Queries.GetAgentRunEvents.resultPipe,
		},
	})(async (req) => getSelectedPortfolioAgentRunEvents(context, req.cookies, req.params.agentRunId, req.query))
}

function getSelectedPortfolioAgentRunEvents(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	agentRunId: string,
	query: AgentRunEventsQuery,
): Promise<Queries.GetAgentRunEvents.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const events = await core.queries.getAgentRunEvents({ agentRunId, afterSequence: query.afterSequence, limit: query.limit })
		return events.ok ? events.value : throwCoreOperationError(events.error)
	})
}
