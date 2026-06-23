import type { Domain } from '@gorchestra/core'
import { v } from 'valleyed'

import { selectionCookieName } from '../../../modules/selection-cookie'
import { optionalCookiePipe } from '../../http'
import { idPipe, isoDateTimePipe, nonEmptyStringPipe, nonNegativeIntegerPipe, positiveIntegerPipe } from '../../schemas'
import { sessionCookieSchema } from '../../session'

const selectionCookieSchema = optionalCookiePipe(selectionCookieName)

export const portfolioRequestCookieSchema = v.merge(sessionCookieSchema, selectionCookieSchema)
export const createProjectRequestSchema = v.object({ title: v.string().pipe(v.asTrimmed(), v.min(1, 'Project title is required')) })
export const createPlanRequestSchema = v.object({ title: v.string().pipe(v.asTrimmed(), v.min(1, 'Plan title is required')) })
export const createSecretRequestSchema = v.object({
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
export const createRepositoryRequestSchema = v.object({ config: repositoryConfigRequestSchema })

const localActorRefResponseSchema = v.object({ type: v.string(), id: v.string() })
const runtimeRecordResponseSchema = v.object({ at: isoDateTimePipe })
export const auditStampResponseSchema = v.discriminate((value) => value.origin, {
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

const planModelConfigResponseSchema = v.object({ planningModelId: v.nullable(idPipe) })
const planConfigResponseSchema = v.object({ model: v.nullable(planModelConfigResponseSchema) })
const planConfigRecordResponseSchema = v.object({ configured: auditStampResponseSchema, value: v.nullable(planConfigResponseSchema) })

const deliveryModelConfigResponseSchema = v.object({
	revisionPlanningModelId: v.nullable(idPipe),
	executionModelId: v.nullable(idPipe),
	revisionExecutionModelId: v.nullable(idPipe),
})
const deliveryConfigResponseSchema = v.object({
	model: v.nullable(deliveryModelConfigResponseSchema),
	work: v.nullable(deliveryWorkConfigResponseSchema),
})
const deliveryConfigRecordResponseSchema = v.object({
	configured: auditStampResponseSchema,
	value: v.nullable(deliveryConfigResponseSchema),
})

const githubRepositoryConfigResponseSchema = v.object({
	provider: v.is('github' as const),
	owner: nonEmptyStringPipe,
	name: nonEmptyStringPipe,
	secretId: idPipe,
})
const repositoryConfigResponseSchema = v.discriminate((value) => value.provider, { github: githubRepositoryConfigResponseSchema })
export const repositoryResponseSchema = v.object({
	id: idPipe,
	projectId: idPipe,
	config: repositoryConfigResponseSchema,
	created: auditStampResponseSchema,
})

const listedProjectSourceResponseSchema = v.discriminate((value) => value.type, {
	'source-control': v.object({ type: v.is('source-control' as const), repositories: v.array(repositoryResponseSchema) }),
})
export const listedProjectResponseSchema = v.object({
	id: idPipe,
	title: nonEmptyStringPipe,
	source: listedProjectSourceResponseSchema,
	config: v.nullable(projectConfigRecordResponseSchema),
	created: auditStampResponseSchema,
})

const modelAgentResponseSchema = v.object({ type: v.is('model' as const), modelId: idPipe })
const planningAgentRunResponseSchema = v.object({
	id: idPipe,
	agent: modelAgentResponseSchema,
	purpose: v.object({ type: v.is('planning' as const), planId: idPipe }),
	started: runtimeRecordResponseSchema,
	completed: v.nullable(runtimeRecordResponseSchema),
})

export const planResponseSchema = v.object({
	id: idPipe,
	projectId: idPipe,
	title: nonEmptyStringPipe,
	config: v.nullable(planConfigRecordResponseSchema),
	created: auditStampResponseSchema,
	agentRun: planningAgentRunResponseSchema,
})

const sourceControlDeliveryTargetResponseSchema = v.object({
	type: v.is('source-control' as const),
	repository: repositoryResponseSchema,
	targetBranch: nonEmptyStringPipe,
})
const deliveryTargetResponseSchema = v.discriminate((value) => value.type, {
	'source-control': sourceControlDeliveryTargetResponseSchema,
})
const instructionSourceResponseSchema = v.object({ body: v.string() })
const sliceResponseSchema = v.object({
	id: idPipe,
	deliveryId: idPipe,
	order: nonNegativeIntegerPipe,
	title: nonEmptyStringPipe,
	instruction: instructionSourceResponseSchema,
	accepted: auditStampResponseSchema,
})
const deliveryClosedResponseSchema = v.discriminate((value) => value.type, {
	shipped: v.object({
		type: v.is('shipped' as const),
		shipped: auditStampResponseSchema,
		integration: v.discriminate((value) => value.type, {
			'review-surface-merged': v.object({ type: v.is('review-surface-merged' as const), reviewSurfaceId: idPipe }),
			'observed-artifact-integration': v.object({ type: v.is('observed-artifact-integration' as const), actionId: idPipe }),
		}),
	}),
	abandoned: v.object({ type: v.is('abandoned' as const), abandoned: auditStampResponseSchema, reason: v.string() }),
})
export const deliveryResponseSchema = v.object({
	id: idPipe,
	projectId: idPipe,
	planId: idPipe,
	title: nonEmptyStringPipe,
	target: deliveryTargetResponseSchema,
	config: v.nullable(deliveryConfigRecordResponseSchema),
	accepted: auditStampResponseSchema,
	queued: v.nullable(auditStampResponseSchema),
	closed: v.nullable(deliveryClosedResponseSchema),
	slices: v.array(sliceResponseSchema),
})

const secretBindingScopeResponseSchema = v.discriminate((value) => value.type, {
	portfolio: v.object({ type: v.is('portfolio' as const) }),
	project: v.object({ type: v.is('project' as const), projectId: idPipe }),
	delivery: v.object({ type: v.is('delivery' as const), deliveryId: idPipe }),
})
const modelProviderProtocolResponseSchema = v.in(['anthropic-messages', 'openai-responses', 'openai-completions', 'google-generative-ai'])
const repositoryAccessSecretReferenceResponseSchema = v.object({
	type: v.is('repository-access' as const),
	repositoryId: idPipe,
	projectId: idPipe,
	provider: v.is('github' as const),
	owner: nonEmptyStringPipe,
	name: nonEmptyStringPipe,
	created: auditStampResponseSchema,
})
const secretBindingSecretReferenceResponseSchema = v.object({
	type: v.is('secret-binding' as const),
	secretBindingId: idPipe,
	scope: secretBindingScopeResponseSchema,
	envName: nonEmptyStringPipe,
	archived: v.boolean(),
	created: auditStampResponseSchema,
})
const modelProviderAuthSecretReferenceResponseSchema = v.object({
	type: v.is('model-provider-auth' as const),
	modelProviderId: idPipe,
	name: nonEmptyStringPipe,
	protocol: modelProviderProtocolResponseSchema,
	archived: v.boolean(),
	created: auditStampResponseSchema,
})
const modelProviderHeaderSecretReferenceResponseSchema = v.object({
	type: v.is('model-provider-header' as const),
	modelProviderId: idPipe,
	name: nonEmptyStringPipe,
	protocol: modelProviderProtocolResponseSchema,
	headerName: nonEmptyStringPipe,
	archived: v.boolean(),
	created: auditStampResponseSchema,
})
const secretReferenceResponseSchema = v.discriminate((value) => value.type, {
	'repository-access': repositoryAccessSecretReferenceResponseSchema,
	'secret-binding': secretBindingSecretReferenceResponseSchema,
	'model-provider-auth': modelProviderAuthSecretReferenceResponseSchema,
	'model-provider-header': modelProviderHeaderSecretReferenceResponseSchema,
})
export const secretResponseSchema = v.object({
	id: idPipe,
	name: nonEmptyStringPipe,
	created: auditStampResponseSchema,
	replaced: v.nullable(auditStampResponseSchema),
	archived: v.boolean(),
	references: v.array(secretReferenceResponseSchema),
})

export const repositoryPreflightEvidenceResponseSchema = v.object({
	type: v.is('validation' as const),
	operation: v.object({ type: v.is('repository-preflight' as const) }),
	passed: v.boolean(),
	summary: nonEmptyStringPipe,
})

export type PortfolioRequestCookies = Record<string, string | undefined>
export type CreateProjectRequest = { title: string }
export type CreatePlanRequest = { title: string }
export type CreateSecretRequest = { name: string; value: string }
export type CreateRepositoryRequest = { config: Domain.Repository.RepositoryConfig }
export type RepositoryPreflightEvidence = Domain.Evidence.ValidationEvidence & { operation: { type: 'repository-preflight' } }
