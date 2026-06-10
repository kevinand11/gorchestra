import { v, type PipeOutput } from 'valleyed'

import type {
	DeliveryId,
	MemoryId,
	ModelId,
	ModelProviderId,
	PlanId,
	ProjectId,
	RepositoryId,
	ReviewSurfaceId,
	RevisionGateId,
	SecretBindingId,
	SecretId,
	SliceId,
} from './model'
import { storagePipe } from './services'

const rawStringPipe = v.string()
const nonEmptyRawStringPipe = v.string().pipe(v.min(1, 'Expected a non-empty string.'))
const trimmedStringPipe = v.string().pipe(v.asTrimmed())
const nonEmptyTrimmedStringPipe = trimmedStringPipe.pipe(v.min(1, 'Expected a non-empty string.'))
const freeFormStringPipe = trimmedStringPipe
const secretValueRefPipe = nonEmptyTrimmedStringPipe
const integerPipe = v.number().pipe(v.int('Expected an integer.'))
const positiveIntegerPipe = integerPipe.pipe(v.gte(1, 'Expected a number greater than or equal to 1.'))
const nonNegativeIntegerPipe = integerPipe.pipe(v.gte(0, 'Expected a number greater than or equal to 0.'))
const modelProviderBaseUrlPipe = nonEmptyTrimmedStringPipe.pipe(v.define<string, string>((value) => value.replace(/\/+$/, ''))).pipe(
	v.custom<string>((value) => {
		try {
			const url = new URL(value)
			const hostname = url.hostname.toLowerCase()

			return url.protocol === 'https:' || (url.protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1'))
		} catch {
			return false
		}
	}, 'Expected an https URL, or an http localhost URL.'),
)
const headerNamePipe = nonEmptyTrimmedStringPipe.pipe(
	v.custom<string>((value) => /^[A-Za-z0-9-]+$/.test(value), 'Expected an HTTP header name.'),
)
const envNamePipe = nonEmptyTrimmedStringPipe.pipe(
	v.custom<string>((value) => /^[A-Z_][A-Z0-9_]*$/.test(value), 'Expected an environment variable name.'),
)

const projectIdPipe = brandedIdPipe<ProjectId>()
const repositoryIdPipe = brandedIdPipe<RepositoryId>()
const planIdPipe = brandedIdPipe<PlanId>()
const deliveryIdPipe = brandedIdPipe<DeliveryId>()
const sliceIdPipe = brandedIdPipe<SliceId>()
const secretIdPipe = brandedIdPipe<SecretId>()
const secretBindingIdPipe = brandedIdPipe<SecretBindingId>()
const modelProviderIdPipe = brandedIdPipe<ModelProviderId>()
const modelIdPipe = brandedIdPipe<ModelId>()
const reviewSurfaceIdPipe = brandedIdPipe<ReviewSurfaceId>()
const revisionGateIdPipe = brandedIdPipe<RevisionGateId>()

export const localActorRefPipe = v.object({ type: rawStringPipe, id: rawStringPipe })

export const operationContextPipe = v.object({ actor: localActorRefPipe, correlationId: v.nullable(rawStringPipe) })
export type OperationContext = PipeOutput<typeof operationContextPipe>

const encryptedSnapshotPayloadPipe = v
	.instanceOf(Uint8Array, 'Expected a Uint8Array encrypted snapshot payload.')
	.pipe(v.custom<Uint8Array<ArrayBuffer>>((value) => value.byteLength > 0, 'Expected a non-empty encrypted snapshot payload.'))

export const importSnapshotInputPipe = v.object({
	passphrase: nonEmptyRawStringPipe,
	encryptedPayload: encryptedSnapshotPayloadPipe,
	storage: storagePipe,
})
export type ImportSnapshotInput = PipeOutput<typeof importSnapshotInputPipe>

export const importSnapshotBoundaryPipe = v.object({ input: importSnapshotInputPipe, context: operationContextPipe })

const modelProviderProtocolPipe = enumStringPipe(['anthropic-messages', 'openai-responses', 'openai-completions', 'google-generative-ai'])
const modelProviderAuthPipe = v.discriminate(discriminator, {
	apiKey: v.object({ type: v.eq('apiKey'), secretId: secretIdPipe }),
})
const modelProviderHeaderPipe = v.object({ name: headerNamePipe, valueSecretId: secretIdPipe })
const deliveryWorkConfigPipe = v.object({
	maxActiveSliceSlots: positiveIntegerPipe,
	maxCorrectionRetriesPerFailure: nonNegativeIntegerPipe,
	modelTimeoutMs: positiveIntegerPipe,
})
const projectModelConfigPipe = v.object({
	planningModelId: v.nullable(modelIdPipe),
	revisionPlanningModelId: v.nullable(modelIdPipe),
	executionModelId: v.nullable(modelIdPipe),
	revisionExecutionModelId: v.nullable(modelIdPipe),
})
const portfolioModelConfigPipe = v.object({
	defaultModelId: modelIdPipe,
	planningModelId: v.nullable(modelIdPipe),
	revisionPlanningModelId: v.nullable(modelIdPipe),
	executionModelId: v.nullable(modelIdPipe),
	revisionExecutionModelId: v.nullable(modelIdPipe),
})
const planModelConfigPipe = v.object({ planningModelId: v.nullable(modelIdPipe) })
const deliveryModelConfigPipe = v.object({
	revisionPlanningModelId: v.nullable(modelIdPipe),
	executionModelId: v.nullable(modelIdPipe),
	revisionExecutionModelId: v.nullable(modelIdPipe),
})
const portfolioConfigPipe = v.object({ model: portfolioModelConfigPipe, work: v.nullable(deliveryWorkConfigPipe) })
const projectConfigPipe = v.object({
	model: v.nullable(projectModelConfigPipe),
	work: v.nullable(deliveryWorkConfigPipe),
})
const planConfigPipe = v.object({ model: v.nullable(planModelConfigPipe) })
const deliveryConfigPipe = v.object({
	model: v.nullable(deliveryModelConfigPipe),
	work: v.nullable(deliveryWorkConfigPipe),
})

const projectSourcePipe = v.discriminate(discriminator, {
	'source-control': v.object({ type: v.eq('source-control') }),
})
const repositoryConfigPipe = v.discriminate(discriminatorFrom('provider'), {
	github: v.object({
		provider: v.eq('github'),
		owner: nonEmptyTrimmedStringPipe,
		name: nonEmptyTrimmedStringPipe,
		secretId: secretIdPipe,
	}),
})
const proposedDeliveryTargetPipe = v.discriminate(discriminator, {
	'source-control': v.object({
		type: v.eq('source-control'),
		repositoryId: repositoryIdPipe,
		targetBranch: nonEmptyTrimmedStringPipe,
	}),
})
const instructionSourcePipe = v.object({ body: freeFormStringPipe })
const proposedSlicePipe = v.object({
	proposedSliceKey: nonEmptyTrimmedStringPipe,
	title: nonEmptyTrimmedStringPipe,
	instruction: instructionSourcePipe,
	dependsOnProposedSliceKeys: v.array(nonEmptyTrimmedStringPipe),
})
const proposedDeliveryPipe = v.object({
	proposedDeliveryKey: nonEmptyTrimmedStringPipe,
	title: nonEmptyTrimmedStringPipe,
	target: proposedDeliveryTargetPipe,
	slices: v.array(proposedSlicePipe),
	dependsOnDeliveryIds: v.array(deliveryIdPipe),
})
const memoryTypePipe = enumStringPipe(['decision', 'fact', 'constraint', 'assumption', 'risk', 'architecture', 'workflow', 'convention'])
const proposedMemoryPipe = v.object({
	proposedMemoryKey: nonEmptyTrimmedStringPipe,
	title: nonEmptyTrimmedStringPipe,
	body: freeFormStringPipe,
	type: v.nullable(memoryTypePipe),
})
const graphNodeRefPipe = v.discriminate(discriminator, {
	plan: v.object({ type: v.eq('plan'), id: planIdPipe }),
	project: v.object({ type: v.eq('project'), id: projectIdPipe }),
	delivery: v.object({ type: v.eq('delivery'), id: deliveryIdPipe }),
	slice: v.object({ type: v.eq('slice'), id: sliceIdPipe }),
	memory: v.object({ type: v.eq('memory'), id: brandedIdPipe<MemoryId>() }),
})
const proposedGraphRefPipe = v.discriminate(discriminator, {
	existing: v.object({ type: v.eq('existing'), node: graphNodeRefPipe }),
	'proposed-delivery': v.object({ type: v.eq('proposed-delivery'), proposedDeliveryKey: nonEmptyTrimmedStringPipe }),
	'proposed-slice': v.object({ type: v.eq('proposed-slice'), proposedSliceKey: nonEmptyTrimmedStringPipe }),
	'proposed-memory': v.object({ type: v.eq('proposed-memory'), proposedMemoryKey: nonEmptyTrimmedStringPipe }),
})
const linkTypePipe = enumStringPipe(['produced', 'implements', 'references', 'supersedes', 'supports', 'contradicts', 'depends-on'])
const proposedLinkPipe = v.object({ type: linkTypePipe, from: proposedGraphRefPipe, to: proposedGraphRefPipe })
const planOutputProposalPipe = v.object({
	proposedDeliveries: v.array(proposedDeliveryPipe),
	proposedMemories: v.array(proposedMemoryPipe),
	proposedLinks: v.array(proposedLinkPipe),
})
const revisionDispositionPipe = v.object({ body: freeFormStringPipe })
const revisionOutputProposalPipe = v.object({
	instruction: instructionSourcePipe,
	disposition: revisionDispositionPipe,
})
const secretBindingScopePipe = v.discriminate(discriminator, {
	portfolio: v.object({ type: v.eq('portfolio') }),
	project: v.object({ type: v.eq('project'), projectId: projectIdPipe }),
	delivery: v.object({ type: v.eq('delivery'), deliveryId: deliveryIdPipe }),
})

export const setPortfolioConfigInputPipe = v.object({ config: portfolioConfigPipe })
export type SetPortfolioConfigInput = PipeOutput<typeof setPortfolioConfigInputPipe>

export const createModelProviderInputPipe = v.object({
	name: nonEmptyTrimmedStringPipe,
	protocol: modelProviderProtocolPipe,
	baseUrl: modelProviderBaseUrlPipe,
	auth: v.nullable(modelProviderAuthPipe),
	headers: v.array(modelProviderHeaderPipe),
})
export type CreateModelProviderInput = PipeOutput<typeof createModelProviderInputPipe>

export const updateModelProviderInputPipe = v.object({
	modelProviderId: modelProviderIdPipe,
	name: nonEmptyTrimmedStringPipe,
	baseUrl: modelProviderBaseUrlPipe,
	auth: v.nullable(modelProviderAuthPipe),
	headers: v.array(modelProviderHeaderPipe),
})
export type UpdateModelProviderInput = PipeOutput<typeof updateModelProviderInputPipe>

export const archiveModelProviderInputPipe = v.object({ modelProviderId: modelProviderIdPipe })
export type ArchiveModelProviderInput = PipeOutput<typeof archiveModelProviderInputPipe>

export const unarchiveModelProviderInputPipe = v.object({ modelProviderId: modelProviderIdPipe })
export type UnarchiveModelProviderInput = PipeOutput<typeof unarchiveModelProviderInputPipe>

export const createModelInputPipe = v.object({
	providerId: modelProviderIdPipe,
	name: nonEmptyTrimmedStringPipe,
	providerModelId: nonEmptyTrimmedStringPipe,
})
export type CreateModelInput = PipeOutput<typeof createModelInputPipe>

export const updateModelInputPipe = v.object({ modelId: modelIdPipe, name: nonEmptyTrimmedStringPipe })
export type UpdateModelInput = PipeOutput<typeof updateModelInputPipe>

export const archiveModelInputPipe = v.object({ modelId: modelIdPipe })
export type ArchiveModelInput = PipeOutput<typeof archiveModelInputPipe>

export const unarchiveModelInputPipe = v.object({ modelId: modelIdPipe })
export type UnarchiveModelInput = PipeOutput<typeof unarchiveModelInputPipe>

export const preflightModelInputPipe = v.object({ modelId: modelIdPipe })
export type PreflightModelInput = PipeOutput<typeof preflightModelInputPipe>

export const preflightRepositoryInputPipe = v.object({ repositoryId: repositoryIdPipe })
export type PreflightRepositoryInput = PipeOutput<typeof preflightRepositoryInputPipe>

export const createPlanInputPipe = v.object({
	projectId: projectIdPipe,
	title: nonEmptyTrimmedStringPipe,
	config: v.nullable(planConfigPipe),
})
export type CreatePlanInput = PipeOutput<typeof createPlanInputPipe>

export const acceptPlanOutputInputPipe = v.object({ planId: planIdPipe, output: planOutputProposalPipe })
export type AcceptPlanOutputInput = PipeOutput<typeof acceptPlanOutputInputPipe>

export const rejectPlanOutputInputPipe = v.object({ planId: planIdPipe })
export type RejectPlanOutputInput = PipeOutput<typeof rejectPlanOutputInputPipe>

export const configureDeliveryInputPipe = v.object({ deliveryId: deliveryIdPipe, config: deliveryConfigPipe })
export type ConfigureDeliveryInput = PipeOutput<typeof configureDeliveryInputPipe>

export const queueDeliveryInputPipe = v.object({ deliveryId: deliveryIdPipe })
export type QueueDeliveryInput = PipeOutput<typeof queueDeliveryInputPipe>

export const runDeliveryWorkInputPipe = v.object({ deliveryId: deliveryIdPipe })
export type RunDeliveryWorkInput = PipeOutput<typeof runDeliveryWorkInputPipe>

export const retryDeliveryPreflightInputPipe = v.object({ deliveryId: deliveryIdPipe })
export type RetryDeliveryPreflightInput = PipeOutput<typeof retryDeliveryPreflightInputPipe>

export const openRevisionGateInputPipe = v.object({ reviewSurfaceId: reviewSurfaceIdPipe })
export type OpenRevisionGateInput = PipeOutput<typeof openRevisionGateInputPipe>

export const acceptRevisionOutputInputPipe = v.object({ revisionGateId: revisionGateIdPipe, output: revisionOutputProposalPipe })
export type AcceptRevisionOutputInput = PipeOutput<typeof acceptRevisionOutputInputPipe>

export const closeRevisionGateInputPipe = v.object({ revisionGateId: revisionGateIdPipe })
export type CloseRevisionGateInput = PipeOutput<typeof closeRevisionGateInputPipe>

export const shipDeliveryInputPipe = v.object({ deliveryId: deliveryIdPipe })
export type ShipDeliveryInput = PipeOutput<typeof shipDeliveryInputPipe>

export const abandonDeliveryInputPipe = v.object({ deliveryId: deliveryIdPipe, reason: freeFormStringPipe })
export type AbandonDeliveryInput = PipeOutput<typeof abandonDeliveryInputPipe>

export const createProjectInputPipe = v.object({
	title: nonEmptyTrimmedStringPipe,
	source: projectSourcePipe,
	config: v.nullable(projectConfigPipe),
})
export type CreateProjectInput = PipeOutput<typeof createProjectInputPipe>

export const setProjectConfigInputPipe = v.object({ projectId: projectIdPipe, config: projectConfigPipe })
export type SetProjectConfigInput = PipeOutput<typeof setProjectConfigInputPipe>

export const createRepositoryInputPipe = v.object({ projectId: projectIdPipe, config: repositoryConfigPipe })
export type CreateRepositoryInput = PipeOutput<typeof createRepositoryInputPipe>

export const updateRepositoryConfigInputPipe = v.object({ repositoryId: repositoryIdPipe, config: repositoryConfigPipe })
export type UpdateRepositoryConfigInput = PipeOutput<typeof updateRepositoryConfigInputPipe>

export const createSecretInputPipe = v.object({ name: nonEmptyTrimmedStringPipe, valueRef: secretValueRefPipe })
export type CreateSecretInput = PipeOutput<typeof createSecretInputPipe>

export const replaceSecretInputPipe = v.object({ secretId: secretIdPipe, valueRef: secretValueRefPipe })
export type ReplaceSecretInput = PipeOutput<typeof replaceSecretInputPipe>

export const bindSecretInputPipe = v.object({ secretId: secretIdPipe, scope: secretBindingScopePipe, envName: envNamePipe })
export type BindSecretInput = PipeOutput<typeof bindSecretInputPipe>

export const archiveSecretBindingInputPipe = v.object({ secretBindingId: secretBindingIdPipe })
export type ArchiveSecretBindingInput = PipeOutput<typeof archiveSecretBindingInputPipe>

export const exportSnapshotInputPipe = v.object({ passphrase: nonEmptyRawStringPipe })
export type ExportSnapshotInput = PipeOutput<typeof exportSnapshotInputPipe>

export const getDeliveryWorkStateArgumentsPipe = v.tuple([deliveryIdPipe] as const, 'Expected exactly 1 query argument(s).')
export const getSliceWorkStateArgumentsPipe = v.tuple([sliceIdPipe] as const, 'Expected exactly 1 query argument(s).')

function enumStringPipe<const Values extends readonly [string, ...string[]]>(values: Values) {
	const validValues = new Set<string>(values)

	return v
		.string()
		.pipe(v.custom((value) => validValues.has(value), `Expected one of: ${values.join(', ')}.`))
		.pipe(v.define<string, Values[number]>((value) => value as Values[number]))
}

function brandedIdPipe<Id extends string>() {
	return nonEmptyTrimmedStringPipe.pipe(v.define<string, Id>((value) => value as Id))
}

function discriminator(value: unknown): PropertyKey {
	return isRecord(value) ? (value['type'] as PropertyKey) : ''
}

function discriminatorFrom(field: string): (value: unknown) => PropertyKey {
	return (value) => (isRecord(value) ? (value[field] as PropertyKey) : '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
