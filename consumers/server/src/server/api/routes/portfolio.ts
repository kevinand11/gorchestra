import type { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

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

type PortfolioRequestCookies = Record<string, string | undefined>
type CreateProjectRequest = { title: string }

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

function listedProjectFromCreatedProject(project: Domain.Project.Project): Queries.ListProjects.ListedProject {
	return { ...project, source: { type: 'source-control', repositories: [] } }
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
}
