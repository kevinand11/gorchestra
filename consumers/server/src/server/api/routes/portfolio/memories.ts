import type { Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v, type PipeOutput } from 'valleyed'

import { graphNodeRefResponseSchema, memoryResponseSchema, portfolioRequestCookieSchema, type PortfolioRequestCookies } from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { idPipe } from '../../schemas'

const memoryStatusFilterPipe = v.in(['current', 'superseded', 'all'] as const)
const memoryTypeFilterValuePipe = v.nullable(
	v.in(['decision', 'fact', 'constraint', 'assumption', 'risk', 'architecture', 'workflow', 'convention'] as const),
)
const memoryTypeFilterPipe = v.discriminate((value) => value.type, {
	all: v.object({ type: v.is('all' as const) }),
	types: v.object({ type: v.is('types' as const), values: v.array(memoryTypeFilterValuePipe).pipe(v.min(1)) }),
})
const graphNodeTypePipe = v.in(['project', 'plan', 'delivery', 'slice', 'memory'] as const)
const graphNodeSelectorPipe = v.discriminate((value) => value.type, {
	'node-type': v.object({ type: v.is('node-type' as const), nodeType: graphNodeTypePipe }),
	node: v.object({ type: v.is('node' as const), node: graphNodeRefResponseSchema }),
})
const linkTypeFilterPipe = v.discriminate((value) => value.type, {
	all: v.object({ type: v.is('all' as const) }),
	types: v.object({
		type: v.is('types' as const),
		values: v.array(v.in(['produced', 'references', 'supersedes', 'supports', 'contradicts', 'depends-on'] as const)).pipe(v.min(1)),
	}),
})
const linkedNodeFilterPipe = v.discriminate((value) => value.type, {
	all: v.object({ type: v.is('all' as const) }),
	nodes: v.object({ type: v.is('nodes' as const), values: v.array(graphNodeSelectorPipe).pipe(v.min(1)) }),
})
const directMemoryLinkFilterPipe = v.object({ linkTypes: linkTypeFilterPipe, linkedNodes: linkedNodeFilterPipe })
const memoryLinkFilterSetPipe = v.discriminate((value) => value.type, {
	none: v.object({ type: v.is('none' as const) }),
	filters: v.object({
		type: v.is('filters' as const),
		match: v.in(['any', 'all'] as const),
		filters: v.array(directMemoryLinkFilterPipe).pipe(v.min(1)),
	}),
})

const searchQueryStringPipe = v.string().pipe(
	v.asTrimmed(),
	v.min(1),
	v.custom((value) => value !== 'null'),
)
const listMemoriesQuerySchema = v.object({
	status: v.optional(v.fromJson(memoryStatusFilterPipe)),
	search: v.optional(v.fromJson(v.nullable(searchQueryStringPipe))),
	typeFilter: v.optional(v.fromJson(memoryTypeFilterPipe)),
	linkFilter: v.optional(v.fromJson(memoryLinkFilterSetPipe)),
})
type ListMemoriesQuery = PipeOutput<typeof listMemoriesQuerySchema>

export function createMemoriesApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/memories', {
			schema: { cookies: portfolioRequestCookieSchema, query: listMemoriesQuerySchema, response: v.array(memoryResponseSchema) },
		})(async (req) => listSelectedPortfolioMemories(context, req.cookies, req.query))
		.get('/memories/:memoryId', {
			schema: { cookies: portfolioRequestCookieSchema, params: v.object({ memoryId: idPipe }), response: memoryResponseSchema },
		})(async (req) => getSelectedPortfolioMemory(context, req.cookies, req.params.memoryId))
}

function listSelectedPortfolioMemories(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	query: ListMemoriesQuery,
): Promise<Queries.ListMemories.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const memories = await core.queries.listMemories(listMemoriesInput(query))
		return memories.ok ? memories.value : throwCoreOperationError(memories.error)
	})
}

function getSelectedPortfolioMemory(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	memoryId: string,
): Promise<Queries.GetMemory.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const memory = await core.queries.getMemory({ memoryId })
		return memory.ok ? memory.value : throwCoreOperationError(memory.error)
	})
}

const defaultListMemoriesInput = {
	status: 'current',
	search: null,
	typeFilter: { type: 'all' },
	linkFilter: { type: 'none' },
} satisfies Queries.ListMemories.Input

function listMemoriesInput(query: ListMemoriesQuery): Queries.ListMemories.Input {
	return { ...defaultListMemoriesInput, ...definedQueryValues(query) }
}

function definedQueryValues(query: ListMemoriesQuery): Partial<Queries.ListMemories.Input> {
	return Object.fromEntries(Object.entries(query).filter((entry) => entry[1] !== undefined))
}
