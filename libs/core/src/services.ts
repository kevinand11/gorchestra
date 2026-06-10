import { v, type PipeOutput } from 'valleyed'

import type {
	Action,
	ActionId,
	AgentRun,
	AgentRunId,
	Delivery,
	DeliveryArtifact,
	DeliveryArtifactId,
	DeliveryId,
	Link,
	LinkId,
	Memory,
	MemoryId,
	Model,
	ModelId,
	ModelProvider,
	ModelProviderId,
	Plan,
	PlanId,
	PortfolioConfigRecord,
	Project,
	ProjectId,
	Repository,
	RepositoryId,
	ReviewSurface,
	ReviewSurfaceId,
	Revision,
	RevisionGate,
	RevisionGateId,
	RevisionId,
	Secret,
	SecretBinding,
	SecretBindingId,
	SecretId,
	Slice,
	SliceArtifact,
	SliceArtifactId,
	SliceId,
} from './model'

type AnyFunction = (...args: never[]) => unknown

type CoreServicePreflightOutputShape = { ok: true } | { ok: false; message: string | null }

export const coreServicePreflightOutputPipe = v
	.any<CoreServicePreflightOutputShape>()
	.pipe(v.custom<CoreServicePreflightOutputShape>(isCoreServicePreflightOutputValue, 'Expected a Core Service preflight output.'))
export type CoreServicePreflightOutput = PipeOutput<typeof coreServicePreflightOutputPipe>

export interface CorePreflightReport {
	passed: boolean
	checks: CorePreflightChecks
}

export interface CorePreflightChecks {
	storage: CorePreflightCheck
	secrets: CorePreflightCheck
	sandbox: CorePreflightCheck
	clock: CorePreflightCheck
	idGenerator: CorePreflightCheck
}

export type CorePreflightCheck = { ok: true } | { ok: false; reason: 'not-ready' | 'probe-failed'; message: string | null }

export interface CoreStorageTransaction {
	portfolioConfig: SingletonRepository<PortfolioConfigRecord>
	projects: RepositoryTable<Project, ProjectId>
	repositories: RepositoryTable<Repository, RepositoryId>
	modelProviders: RepositoryTable<ModelProvider, ModelProviderId>
	models: RepositoryTable<Model, ModelId>
	plans: RepositoryTable<Plan, PlanId>
	deliveries: RepositoryTable<Delivery, DeliveryId>
	slices: RepositoryTable<Slice, SliceId>
	links: RepositoryTable<Link, LinkId>
	memories: RepositoryTable<Memory, MemoryId>
	deliveryArtifacts: RepositoryTable<DeliveryArtifact, DeliveryArtifactId>
	sliceArtifacts: RepositoryTable<SliceArtifact, SliceArtifactId>
	actions: RepositoryTable<Action, ActionId>
	agentRuns: RepositoryTable<AgentRun, AgentRunId>
	reviewSurfaces: RepositoryTable<ReviewSurface, ReviewSurfaceId>
	revisionGates: RepositoryTable<RevisionGate, RevisionGateId>
	revisions: RepositoryTable<Revision, RevisionId>
	secrets: RepositoryTable<Secret, SecretId>
	secretBindings: RepositoryTable<SecretBinding, SecretBindingId>
}

export interface SingletonRepository<T> {
	get(): Promise<T | null>
	put(record: T): Promise<void>
}

export interface RepositoryTable<T, Id> {
	get(id: Id): Promise<T | null>
	put(record: T): Promise<void>
	list(): Promise<T[]>
}

export interface ResolveSecretsInput {
	scope: { type: 'project'; projectId: ProjectId } | { type: 'delivery'; deliveryId: DeliveryId }
}

export interface ResolveSecretValuesInput {
	secretIds: SecretId[]
}

export interface ResolvedSecret {
	secretId: SecretId
	envName: string

	/** Plaintext exists only transiently. */
	plaintext: string
}

export interface ResolvedSecretValue {
	secretId: SecretId

	/** Plaintext exists only transiently. */
	plaintext: string
}

export type CoreEvent =
	| { type: 'delivery-updated'; deliveryId: DeliveryId }
	| { type: 'slice-updated'; sliceId: SliceId }
	| { type: 'delivery-work-run'; deliveryId: DeliveryId }
	| { type: 'agent-run-started'; agentRunId: AgentRunId }
	| { type: 'review-surface-created'; reviewSurfaceId: ReviewSurfaceId }
	| { type: 'revision-gate-opened'; revisionGateId: RevisionGateId }

type CoreStorageServiceShape = {
	preflight(): Promise<CoreServicePreflightOutput>
	transaction<T>(fn: (tx: CoreStorageTransaction) => Promise<T>): Promise<T>
}

type CoreSecretsServiceShape = {
	preflight(): Promise<CoreServicePreflightOutput>
	resolveSecrets(input: ResolveSecretsInput): Promise<ResolvedSecret[]>
	resolveSecretValues(input: ResolveSecretValuesInput): Promise<ResolvedSecretValue[]>
}

/**
 * Sandbox capabilities are deployment-specific and consumed by Core-owned Agent
 * Run orchestration. The current stub validates only that a sandbox service
 * object is present.
 */
type CoreSandboxServiceShape = {
	preflight(): Promise<CoreServicePreflightOutput>
	[capability: string]: unknown
}

type CoreEventSinkShape = {
	publish(event: CoreEvent): void
}

type CoreLoggerShape = {
	debug(message: string, context: Record<string, unknown> | null): void
	info(message: string, context: Record<string, unknown> | null): void
	warn(message: string, context: Record<string, unknown> | null): void
	error(message: string, context: Record<string, unknown> | null): void
}

type CoreClockServiceShape = {
	now(): Date
}

type CoreIdGeneratorServiceShape = {
	next<Name extends string>(brand: Name): string
}

export const functionDependencyPipe = v
	.any<AnyFunction>()
	.pipe(v.custom((value) => typeof value === 'function', 'Expected a function dependency.'))

const storagePreflightPipe = typedFunctionDependencyPipe<CoreStorageServiceShape['preflight']>()
const storageTransactionPipe = typedFunctionDependencyPipe<CoreStorageServiceShape['transaction']>()
const secretsPreflightPipe = typedFunctionDependencyPipe<CoreSecretsServiceShape['preflight']>()
const resolveSecretsPipe = typedFunctionDependencyPipe<CoreSecretsServiceShape['resolveSecrets']>()
const resolveSecretValuesPipe = typedFunctionDependencyPipe<CoreSecretsServiceShape['resolveSecretValues']>()
const sandboxPreflightPipe = typedFunctionDependencyPipe<CoreSandboxServiceShape['preflight']>()
const clockNowPipe = typedFunctionDependencyPipe<CoreClockServiceShape['now']>()
const idGeneratorNextPipe = typedFunctionDependencyPipe<CoreIdGeneratorServiceShape['next']>()
const eventSinkPublishPipe = typedFunctionDependencyPipe<CoreEventSinkShape['publish']>()
const loggerDebugPipe = typedFunctionDependencyPipe<CoreLoggerShape['debug']>()
const loggerInfoPipe = typedFunctionDependencyPipe<CoreLoggerShape['info']>()
const loggerWarnPipe = typedFunctionDependencyPipe<CoreLoggerShape['warn']>()
const loggerErrorPipe = typedFunctionDependencyPipe<CoreLoggerShape['error']>()

export const storagePipe = v.object({ preflight: storagePreflightPipe, transaction: storageTransactionPipe })
export type CoreStorageService = PipeOutput<typeof storagePipe>
export type CoreStorage = CoreStorageService

export const coreSecretsServicePipe = v.object({
	preflight: secretsPreflightPipe,
	resolveSecrets: resolveSecretsPipe,
	resolveSecretValues: resolveSecretValuesPipe,
})
export type CoreSecretsService = PipeOutput<typeof coreSecretsServicePipe>

const coreSandboxServiceObjectPipe = v.object({ preflight: sandboxPreflightPipe })
export const coreSandboxServicePipe = coreSandboxServiceObjectPipe.pipe(
	v.define<PipeOutput<typeof coreSandboxServiceObjectPipe>, CoreSandboxServiceShape>((value) => value),
)
export type CoreSandboxService = PipeOutput<typeof coreSandboxServicePipe>

const coreClockServicePipe = v.object({ now: clockNowPipe })
export type CoreClockService = PipeOutput<typeof coreClockServicePipe>

const coreIdGeneratorServicePipe = v.object({ next: idGeneratorNextPipe })
export type CoreIdGeneratorService = PipeOutput<typeof coreIdGeneratorServicePipe>

const coreEventSinkPipe = v.object({ publish: eventSinkPublishPipe })
export type CoreEventSink = PipeOutput<typeof coreEventSinkPipe>

const coreLoggerPipe = v.object({
	debug: loggerDebugPipe,
	info: loggerInfoPipe,
	warn: loggerWarnPipe,
	error: loggerErrorPipe,
})
export type CoreLogger = PipeOutput<typeof coreLoggerPipe>

const optionalCoreEventSinkPipe = v
	.any<CoreEventSink | undefined>()
	.pipe(
		v.custom(
			(value) => value === undefined || acceptsPipe(coreEventSinkPipe, value),
			'Expected a Core Event Sink service when provided.',
		),
	)
const optionalCoreLoggerPipe = v
	.any<CoreLogger | undefined>()
	.pipe(v.custom((value) => value === undefined || acceptsPipe(coreLoggerPipe, value), 'Expected a Core Logger service when provided.'))

type OpenCoreOptionsShape = {
	storage: CoreStorageService
	secrets: CoreSecretsService
	sandbox: CoreSandboxService
	clock: CoreClockService
	idGenerator: CoreIdGeneratorService
	logger?: CoreLogger
	eventSink?: CoreEventSink
}

const openCoreOptionsObjectPipe = v.object({
	storage: storagePipe,
	secrets: coreSecretsServicePipe,
	sandbox: coreSandboxServicePipe,
	clock: coreClockServicePipe,
	idGenerator: coreIdGeneratorServicePipe,
	logger: optionalCoreLoggerPipe,
	eventSink: optionalCoreEventSinkPipe,
})

export const openCoreOptionsPipe = openCoreOptionsObjectPipe.pipe(
	v.define<PipeOutput<typeof openCoreOptionsObjectPipe>, OpenCoreOptionsShape>((value) => {
		const options: OpenCoreOptionsShape = {
			storage: value.storage,
			secrets: value.secrets,
			sandbox: value.sandbox,
			clock: value.clock,
			idGenerator: value.idGenerator,
		}

		if (value.logger !== undefined) {
			options.logger = value.logger
		}

		if (value.eventSink !== undefined) {
			options.eventSink = value.eventSink
		}

		return options
	}),
)
export type OpenCoreOptions = PipeOutput<typeof openCoreOptionsPipe>

export const coreClockOutputPipe = v
	.instanceOf(Date, 'Expected a Date.')
	.pipe(v.custom<Date>((value) => !Number.isNaN(value.getTime()), 'Expected a valid Date.'))
export const coreIdOutputPipe = v.string().pipe(v.asTrimmed()).pipe(v.min(1, 'Expected a non-empty string.'))

function acceptsPipe(pipe: typeof coreEventSinkPipe | typeof coreLoggerPipe, value: unknown): boolean {
	return v.validate(pipe, value).valid
}

function typedFunctionDependencyPipe<Fn>() {
	return v.any<Fn>().pipe(v.custom((value) => typeof value === 'function', 'Expected a function dependency.'))
}

function isCoreServicePreflightOutputValue(value: unknown): boolean {
	if (!isRecord(value)) {
		return false
	}

	if (value['ok'] === true) {
		return true
	}

	return value['ok'] === false && (typeof value['message'] === 'string' || value['message'] === null)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
