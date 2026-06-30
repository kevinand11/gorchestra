import { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v, type PipeOutput } from 'valleyed'

import {
	createMemoryRequestSchema,
	createMemoryRevisionRequestSchema,
	portfolioRequestCookieSchema,
	type CreateMemoryRequest,
	type CreateMemoryRevisionRequest,
	type PortfolioRequestCookies,
} from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { idPipe } from '../../schemas'

const listMemoryChildrenQuerySchema = v.object({ parentId: v.defaults(v.fromJson(v.nullable(idPipe)), null) })
type ListMemoryChildrenQuery = PipeOutput<typeof listMemoryChildrenQuerySchema>

export function createMemoriesApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/memories', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				query: listMemoryChildrenQuerySchema,
				response: Queries.ListMemoryChildren.resultPipe,
			},
		})(async (req) => listSelectedPortfolioMemoryChildren(context, req.cookies, req.query))
		.post('/memories', {
			schema: { cookies: portfolioRequestCookieSchema, body: createMemoryRequestSchema, response: Domain.Memory.memoryPipe },
		})(async (req) => createSelectedPortfolioMemory(context, req.cookies, req.body))
		.get('/memories/:memoryId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ memoryId: idPipe }),
				response: Queries.GetMemory.resultPipe,
			},
		})(async (req) => getSelectedPortfolioMemory(context, req.cookies, req.params.memoryId))
		.post('/memories/:memoryId/revisions', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ memoryId: idPipe }),
				body: createMemoryRevisionRequestSchema,
				response: Domain.Memory.memoryPipe,
			},
		})(async (req) => createSelectedPortfolioMemoryRevision(context, req.cookies, req.params.memoryId, req.body))
}

function listSelectedPortfolioMemoryChildren(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	query: ListMemoryChildrenQuery,
): Promise<Queries.ListMemoryChildren.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const memories = await core.queries.listMemoryChildren({ parentId: query.parentId })
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

function createSelectedPortfolioMemoryRevision(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	memoryId: string,
	input: CreateMemoryRevisionRequest,
): Promise<Domain.Memory.Memory> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const memory = await core.commands.createMemoryRevision(
			{ memoryId, ...input },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
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
