import { Router } from 'equipped/server'
import { v } from 'valleyed'

import { selectionCookieName } from '../../modules/selection-cookie'
import type { ServerApiContext } from '../context'
import { throwCoreOperationError } from '../errors'
import { optionalCookiePipe } from '../http'
import { withSelectedPortfolioCore } from '../portfolio-context'
import { idPipe, isoDateTimePipe, nonEmptyStringPipe, nonNegativeIntegerPipe, positiveIntegerPipe } from '../schemas'
import { sessionCookieSchema } from '../session'

const selectionCookieSchema = optionalCookiePipe(selectionCookieName)
const portfolioRequestCookieSchema = v.merge(sessionCookieSchema, selectionCookieSchema)
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

export function createPortfolioApiRouter(context: ServerApiContext) {
	return new Router({ path: '/portfolio' }).get('/projects', {
		schema: { cookies: portfolioRequestCookieSchema, response: v.array(listedProjectResponseSchema) },
	})(async (req) =>
		withSelectedPortfolioCore(context, req.cookies, async ({ core }) => {
			const projects = await core.queries.listProjects({})
			return projects.ok ? projects.value : throwCoreOperationError(projects.error)
		}),
	)
}
