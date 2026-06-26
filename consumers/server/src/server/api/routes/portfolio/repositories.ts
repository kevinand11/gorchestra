import type { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import { listRepositoriesResponsePipe, repositoryResponsePipe, validationEvidenceResponsePipe } from './response-pipes'
import {
	createRepositoryRequestSchema,
	portfolioRequestCookieSchema,
	type CreateRepositoryRequest,
	type PortfolioRequestCookies,
	type RepositoryPreflightEvidence,
} from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { idPipe } from '../../schemas'

export function createRepositoriesApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/projects/:projectId/repositories', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe }),
				response: listRepositoriesResponsePipe,
			},
		})(async (req) => listSelectedProjectRepositories(context, req.cookies, req.params.projectId))
		.post('/projects/:projectId/repositories', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe }),
				body: createRepositoryRequestSchema,
				response: repositoryResponsePipe,
			},
		})(async (req) =>
			createSelectedProjectRepository(context, req.cookies, req.params.projectId, req.body as unknown as CreateRepositoryRequest),
		)
		.get('/projects/:projectId/repositories/:repositoryId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe, repositoryId: idPipe }),
				response: repositoryResponsePipe,
			},
		})(async (req) => getSelectedProjectRepository(context, req.cookies, req.params.projectId, req.params.repositoryId))
		.post('/projects/:projectId/repositories/:repositoryId/preflight', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe, repositoryId: idPipe }),
				response: validationEvidenceResponsePipe,
			},
		})(async (req) => preflightSelectedProjectRepository(context, req.cookies, req.params.projectId, req.params.repositoryId))
}

function listSelectedProjectRepositories(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
): Promise<Queries.ListRepositories.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const repositories = await core.queries.listRepositories({ projectId })
		return repositories.ok ? repositories.value : throwCoreOperationError(repositories.error)
	})
}

function createSelectedProjectRepository(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
	input: CreateRepositoryRequest,
): Promise<Domain.Repository.Repository> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const repository = await core.commands.createRepository(
			{ projectId, config: input.config },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return repository.ok ? repository.value : throwCoreOperationError(repository.error)
	})
}

function getSelectedProjectRepository(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
	repositoryId: string,
): Promise<Queries.GetRepository.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const repository = await core.queries.getRepository({ projectId, repositoryId })
		return repository.ok ? repository.value : throwCoreOperationError(repository.error)
	})
}

function preflightSelectedProjectRepository(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
	repositoryId: string,
): Promise<RepositoryPreflightEvidence> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const repository = await core.queries.getRepository({ projectId, repositoryId })
		if (!repository.ok) return throwCoreOperationError(repository.error)

		const evidence = await core.commands.preflightRepository(
			{ repositoryId },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return evidence.ok ? repositoryPreflightEvidence(evidence.value) : throwCoreOperationError(evidence.error)
	})
}

function repositoryPreflightEvidence(evidence: Domain.Evidence.ValidationEvidence): RepositoryPreflightEvidence {
	if (evidence.operation.type !== 'repository-preflight') throw new Error('Repository preflight returned unexpected evidence')
	return { ...evidence, operation: evidence.operation }
}
