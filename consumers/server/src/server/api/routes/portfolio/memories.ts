import { Queries, type Domain } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v, type PipeOutput } from 'valleyed'

import { createdMemoryResponsePipe, listMemoriesResponsePipe, memoryResponsePipe } from './response-pipes'
import { createMemoryRequestSchema, portfolioRequestCookieSchema, type CreateMemoryRequest, type PortfolioRequestCookies } from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { idPipe } from '../../schemas'

const searchQueryStringPipe = v.string().pipe(
	v.asTrimmed(),
	v.min(1),
	v.custom((value) => value !== 'null'),
)
const listMemoriesQuerySchema = v.object({
	status: v.optional(v.fromJson(Queries.ListMemories.memoryStatusFilterPipe)),
	search: v.optional(v.fromJson(v.nullable(searchQueryStringPipe))),
	typeFilter: v.optional(v.fromJson(Queries.ListMemories.memoryTypeFilterPipe)),
	linkFilter: v.optional(v.fromJson(Queries.ListMemories.memoryLinkFilterSetPipe)),
})
type ListMemoriesQuery = PipeOutput<typeof listMemoriesQuerySchema>

export function createMemoriesApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/memories', {
			schema: { cookies: portfolioRequestCookieSchema, query: listMemoriesQuerySchema, response: listMemoriesResponsePipe },
		})(async (req) => listSelectedPortfolioMemories(context, req.cookies, req.query as unknown as ListMemoriesQuery))
		.post('/memories', {
			schema: { cookies: portfolioRequestCookieSchema, body: createMemoryRequestSchema, response: createdMemoryResponsePipe },
		})(async (req) => createSelectedPortfolioMemory(context, req.cookies, req.body as unknown as CreateMemoryRequest))
		.get('/memories/:memoryId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ memoryId: idPipe }),
				response: memoryResponsePipe,
			},
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

function createSelectedPortfolioMemory(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	input: CreateMemoryRequest,
): Promise<Domain.Memory.Memory> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const memory = await core.commands.createMemory(input, {
			actor: { type: 'workspace-member', id: workspaceMember.id },
			correlationId: null,
		})
		return memory.ok ? memory.value : throwCoreOperationError(memory.error)
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
