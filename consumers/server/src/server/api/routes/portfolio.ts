import type { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import { protectSecretPlaintext } from '../../modules/secret-protection'
import { selectionCookieName } from '../../modules/selection-cookie'
import type { ServerApiContext } from '../context'
import { throwCoreOperationError } from '../errors'
import { optionalCookiePipe } from '../http'
import { withSelectedPortfolioCore, withSelectedPortfolioOwnerCore } from '../portfolio-context'
import { idPipe, isoDateTimePipe, nonEmptyStringPipe, nonNegativeIntegerPipe, positiveIntegerPipe } from '../schemas'
import { sessionCookieSchema } from '../session'

const selectionCookieSchema = optionalCookiePipe(selectionCookieName)
const portfolioRequestCookieSchema = v.merge(sessionCookieSchema, selectionCookieSchema)
const createProjectRequestSchema = v.object({ title: v.string().pipe(v.asTrimmed(), v.min(1, 'Project title is required')) })
const createSecretRequestSchema = v.object({
	name: v.string().pipe(v.asTrimmed(), v.min(1, 'Secret name is required')),
	value: v.string().pipe(v.custom<string>((value) => value.trim().length > 0, 'Secret value is required')),
})
const githubRepositoryConfigRequestSchema = v.object({
	provider: v.is('github' as const),
	owner: v.string().pipe(v.asTrimmed(), v.min(1, 'Repository owner is required')),
	name: v.string().pipe(v.asTrimmed(), v.min(1, 'Repository name is required')),
	secretId: idPipe,
})
const repositoryConfigRequestSchema = v.discriminate((value) => value.provider, { github: githubRepositoryConfigRequestSchema })
const createRepositoryRequestSchema = v.object({ config: repositoryConfigRequestSchema })
const localActorRefResponseSchema = v.object({ type: v.string(), id: v.string() })
const auditStampResponseSchema = v.discriminate((value) => value.origin, {
	local: v.object({
		origin: v.is('local' as const),
		at: isoDateTimePipe,
		actor: localActorRefResponseSchema,
		correlationId: v.nullable(v.string()),
	}),
	imported: v.object({ origin: v.is('imported' as const), at: isoDateTimePipe }),
})
const deliveryWorkConfigResponseSchema = v.object({
	maxProcessableSliceSlots: positiveIntegerPipe,
	maxCorrectionRetriesPerFailure: nonNegativeIntegerPipe,
	modelTimeoutMs: positiveIntegerPipe,
})
const projectModelConfigResponseSchema = v.object({
	planningModelId: v.nullable(idPipe),
	revisionPlanningModelId: v.nullable(idPipe),
	executionModelId: v.nullable(idPipe),
	revisionExecutionModelId: v.nullable(idPipe),
})
const projectConfigResponseSchema = v.object({
	model: v.nullable(projectModelConfigResponseSchema),
	work: v.nullable(deliveryWorkConfigResponseSchema),
})
const projectConfigRecordResponseSchema = v.object({ configured: auditStampResponseSchema, value: v.nullable(projectConfigResponseSchema) })
const githubRepositoryConfigResponseSchema = v.object({
	provider: v.is('github' as const),
	owner: nonEmptyStringPipe,
	name: nonEmptyStringPipe,
	secretId: idPipe,
})
const repositoryConfigResponseSchema = v.discriminate((value) => value.provider, { github: githubRepositoryConfigResponseSchema })
const repositoryResponseSchema = v.object({
	id: idPipe,
	projectId: idPipe,
	config: repositoryConfigResponseSchema,
	created: auditStampResponseSchema,
})
const listedProjectSourceResponseSchema = v.discriminate((value) => value.type, {
	'source-control': v.object({ type: v.is('source-control' as const), repositories: v.array(repositoryResponseSchema) }),
})
const listedProjectResponseSchema = v.object({
	id: idPipe,
	title: nonEmptyStringPipe,
	source: listedProjectSourceResponseSchema,
	config: v.nullable(projectConfigRecordResponseSchema),
	created: auditStampResponseSchema,
})
const secretResponseSchema = v.object({
	id: idPipe,
	name: nonEmptyStringPipe,
	created: auditStampResponseSchema,
	replaced: v.nullable(auditStampResponseSchema),
	archived: v.boolean(),
})
const repositoryPreflightEvidenceResponseSchema = v.object({
	type: v.is('validation' as const),
	operation: v.object({ type: v.is('repository-preflight' as const) }),
	passed: v.boolean(),
	summary: nonEmptyStringPipe,
})

type PortfolioRequestCookies = Record<string, string | undefined>
type CreateProjectRequest = { title: string }
type CreateSecretRequest = { name: string; value: string }
type CreateRepositoryRequest = { config: Domain.Repository.RepositoryConfig }
type RepositoryPreflightEvidence = Domain.Evidence.ValidationEvidence & { operation: { type: 'repository-preflight' } }

export function createPortfolioApiRouter(context: ServerApiContext) {
	return new Router({ path: '/portfolio' })
		.get('/projects', {
			schema: { cookies: portfolioRequestCookieSchema, response: v.array(listedProjectResponseSchema) },
		})(async (req) =>
			withSelectedPortfolioCore(context, req.cookies, async ({ core }) => {
				const projects = await core.queries.listProjects({})
				return projects.ok ? projects.value : throwCoreOperationError(projects.error)
			}),
		)
		.post('/projects', {
			schema: { cookies: portfolioRequestCookieSchema, body: createProjectRequestSchema, response: listedProjectResponseSchema },
		})(async (req) => createSelectedPortfolioProject(context, req.cookies, req.body))
		.get('/projects/:projectId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe }),
				response: listedProjectResponseSchema,
			},
		})(async (req) => getSelectedPortfolioProject(context, req.cookies, req.params.projectId))
		.get('/projects/:projectId/repositories', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe }),
				response: v.array(repositoryResponseSchema),
			},
		})(async (req) => listSelectedProjectRepositories(context, req.cookies, req.params.projectId))
		.post('/projects/:projectId/repositories', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe }),
				body: createRepositoryRequestSchema,
				response: repositoryResponseSchema,
			},
		})(async (req) => createSelectedProjectRepository(context, req.cookies, req.params.projectId, req.body))
		.get('/projects/:projectId/repositories/:repositoryId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe, repositoryId: idPipe }),
				response: repositoryResponseSchema,
			},
		})(async (req) => getSelectedProjectRepository(context, req.cookies, req.params.projectId, req.params.repositoryId))
		.post('/projects/:projectId/repositories/:repositoryId/preflight', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe, repositoryId: idPipe }),
				response: repositoryPreflightEvidenceResponseSchema,
			},
		})(async (req) => preflightSelectedProjectRepository(context, req.cookies, req.params.projectId, req.params.repositoryId))
		.get('/secrets', {
			schema: { cookies: portfolioRequestCookieSchema, response: v.array(secretResponseSchema) },
		})(async (req) => listSelectedPortfolioSecrets(context, req.cookies))
		.post('/secrets', {
			schema: { cookies: portfolioRequestCookieSchema, body: createSecretRequestSchema, response: secretResponseSchema },
		})(async (req) => createSelectedPortfolioSecret(context, req.cookies, req.body))
		.get('/secrets/:secretId', {
			schema: { cookies: portfolioRequestCookieSchema, params: v.object({ secretId: idPipe }), response: secretResponseSchema },
		})(async (req) => getSelectedPortfolioSecret(context, req.cookies, req.params.secretId))
}

async function createSelectedPortfolioProject(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	input: CreateProjectRequest,
): Promise<Queries.ListProjects.ListedProject> {
	return withSelectedPortfolioOwnerCore(context, cookies, async ({ core, workspaceMember }) => {
		const project = await core.commands.createProject(
			{ title: input.title, source: { type: 'source-control' }, config: null },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return project.ok ? listedProjectFromCreatedProject(project.value) : throwCoreOperationError(project.error)
	})
}

function getSelectedPortfolioProject(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
): Promise<Queries.GetProject.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const project = await core.queries.getProject({ projectId })
		return project.ok ? project.value : throwCoreOperationError(project.error)
	})
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

function listedProjectFromCreatedProject(project: Domain.Project.Project): Queries.ListProjects.ListedProject {
	return { ...project, source: { type: 'source-control', repositories: [] } }
}

function listSelectedPortfolioSecrets(context: ServerApiContext, cookies: PortfolioRequestCookies): Promise<Queries.ListSecrets.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const secrets = await core.queries.listSecrets({})
		return secrets.ok ? secrets.value : throwCoreOperationError(secrets.error)
	})
}

function getSelectedPortfolioSecret(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	secretId: string,
): Promise<Queries.GetSecret.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const secret = await core.queries.getSecret({ secretId })
		return secret.ok ? secret.value : throwCoreOperationError(secret.error)
	})
}

function createSelectedPortfolioSecret(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	input: CreateSecretRequest,
): Promise<Queries.GetSecret.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const valueRef = protectSecretPlaintext(input.value, context.secretEncryptionKey)
		const secret = await core.commands.createSecret(
			{ name: input.name, valueRef },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return secret.ok ? secretResponseFromCreatedSecret(secret.value) : throwCoreOperationError(secret.error)
	})
}

function secretResponseFromCreatedSecret(secret: Domain.Secret.Secret): Queries.GetSecret.Result {
	return { id: secret.id, name: secret.name, created: secret.created, replaced: secret.replaced, archived: false }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Portfolio API Projects', () => {
		it('returns newly-created Projects with the list item source shape', () => {
			const project: Domain.Project.Project = {
				id: 'project-1',
				title: 'Delivery Ops',
				source: { type: 'source-control' },
				config: null,
				created: { origin: 'imported', at: '2026-06-21T00:00:00.000Z' },
			}

			expect(listedProjectFromCreatedProject(project)).toEqual({
				...project,
				source: { type: 'source-control', repositories: [] },
			})
		})
	})

	describe('Portfolio API Secrets', () => {
		it('redacts protected value refs from newly-created Secret responses', () => {
			const secret: Domain.Secret.Secret = {
				id: 'secret-1',
				name: 'GitHub PAT',
				valueRef: 'gorchestra-secret-value:v1:encrypted',
				created: { origin: 'imported', at: '2026-06-21T00:00:00.000Z' },
				replaced: null,
				archivePeriods: [],
			}

			expect(secretResponseFromCreatedSecret(secret)).toEqual({
				id: 'secret-1',
				name: 'GitHub PAT',
				created: { origin: 'imported', at: '2026-06-21T00:00:00.000Z' },
				replaced: null,
				archived: false,
			})
		})
	})
}
