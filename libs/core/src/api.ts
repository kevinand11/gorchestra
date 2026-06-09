/*
 * Gorchestra core API sketch.
 *
 * This file is documentation-by-type, not an implementation contract yet.
 * It describes how consumers call Portfolio-scoped core operations and sketches
 * Core runtime boundaries. Current Core docs/ADRs define provider behavior,
 * Model Agent runtime behavior, and Snapshot encryption as Core-owned, while
 * consumers provide deployment mechanics as Core Services.
 *
 * Consumers authorize operations before calling core. Core enforces core
 * invariants and owns orchestration behavior inside the opened Portfolio space.
 */

import { v, type Pipe, type PipeError, type PipeOutput } from 'valleyed'

import type {
	Action,
	ActionId,
	AgentRun,
	AgentRunId,
	AgentRunPurpose,
	Delivery,
	DeliveryArtifact,
	DeliveryArtifactId,
	DeliveryConfig,
	DeliveryId,
	DeliveryWorkState,
	ExternalOperationEvidence,
	FetchedFeedback,
	IsoDateTime,
	Link,
	LinkId,
	LocalActorRef,
	Memory,
	MemoryId,
	Model,
	ModelId,
	ModelProvider,
	ModelProviderAuth,
	ModelProviderHeader,
	ModelProviderId,
	ModelProviderProtocol,
	Plan,
	PlanConfig,
	PlanId,
	PlanOutputProposal,
	PortfolioConfig,
	PortfolioConfigRecord,
	PortfolioSnapshotManifest,
	Project,
	ProjectConfig,
	ProjectId,
	ProjectSource,
	Repository,
	RepositoryConfig,
	RepositoryId,
	ReviewSurface,
	ReviewSurfaceId,
	ReviewSurfaceScope,
	Revision,
	RevisionGate,
	RevisionGateId,
	RevisionId,
	RevisionOutputProposal,
	RevisionScope,
	Secret,
	SecretBinding,
	SecretBindingId,
	SecretBindingScope,
	SecretId,
	Slice,
	SliceArtifact,
	SliceArtifactId,
	SliceId,
	ValidationEvidence,
} from './model'

// -----------------------------------------------------------------------------
// Entrypoint
// -----------------------------------------------------------------------------

export interface GorchestraCore {
	commands: CoreCommands
	queries: CoreQueries
}

export interface OpenCoreOptions {
	storage: CoreStorageService
	secrets: CoreSecretsService
	sandbox: CoreSandboxService
	clock: CoreClockService
	idGenerator: CoreIdGeneratorService
	logger?: CoreLogger
	eventSink?: CoreEventSink
}

export function openCore(options: OpenCoreOptions): Result<GorchestraCore, OpenCoreError> {
	const validation = validateCoreInput(openCoreOptionsPipe, options, 'construction', 'openCore')

	if (!validation.ok) {
		return validation
	}

	return {
		ok: true,
		value: {
			commands: createCoreCommands(),
			queries: createCoreQueries(),
		},
	}
}

export interface CoreClockService {
	now(): Date
}

export interface CoreIdGeneratorService {
	next<Name extends string>(brand: Name): string
}

export interface OperationContext {
	actor: LocalActorRef
	correlationId: string | null
}

// -----------------------------------------------------------------------------
// Result / errors
// -----------------------------------------------------------------------------

export type Result<T, E = CoreError> = { ok: true; value: T } | { ok: false; error: E }

export type CoreInputBoundary = 'construction' | 'snapshot-import' | 'command' | 'query'

export interface InvalidInputError {
	type: 'invalid-input'
	boundary: CoreInputBoundary
	operation: string
	pipeError: PipeError
}

export interface NotImplementedError {
	type: 'not-implemented'
	operation: string
}

export type OpenCoreError = InvalidInputError

export type DeliveryWorkStateType = DeliveryWorkState['type']

/**
 * invariant-violation is reserved for impossible/corrupt states.
 * Expected domain failures should use specific CoreError variants.
 */
export type CoreError =
	| InvalidInputError
	| NotImplementedError
	| { type: 'not-found'; resource: string; id: string }
	| { type: 'invariant-violation'; message: string }
	| { type: 'model-preflight-failed'; modelId: ModelId; evidence: ValidationEvidence }
	| {
			type: 'delivery-work-state-mismatch'
			deliveryId: DeliveryId
			expected: DeliveryWorkStateType[]
			actual: DeliveryWorkState
	  }
	| { type: 'revision-gate-closed'; revisionGateId: RevisionGateId }
	| { type: 'agent-run-model-unresolved'; purpose: AgentRunPurpose }
	| { type: 'archived-model'; modelId: ModelId }
	| { type: 'archived-model-provider'; modelProviderId: ModelProviderId }
	| { type: 'external-operation-failed'; evidence: ExternalOperationEvidence }

// -----------------------------------------------------------------------------
// Consumer -> core commands
// -----------------------------------------------------------------------------

export interface CoreCommands {
	// Portfolio config
	setPortfolioConfig(input: SetPortfolioConfigInput, context: OperationContext): Promise<Result<PortfolioConfigRecord>>

	// Model Providers / Models
	createModelProvider(input: CreateModelProviderInput, context: OperationContext): Promise<Result<ModelProvider>>
	updateModelProvider(input: UpdateModelProviderInput, context: OperationContext): Promise<Result<ModelProvider>>
	archiveModelProvider(input: ArchiveModelProviderInput, context: OperationContext): Promise<Result<ModelProvider>>
	unarchiveModelProvider(input: UnarchiveModelProviderInput, context: OperationContext): Promise<Result<ModelProvider>>
	createModel(input: CreateModelInput, context: OperationContext): Promise<Result<Model>>
	updateModel(input: UpdateModelInput, context: OperationContext): Promise<Result<Model>>
	archiveModel(input: ArchiveModelInput, context: OperationContext): Promise<Result<Model>>
	unarchiveModel(input: UnarchiveModelInput, context: OperationContext): Promise<Result<Model>>
	preflightModel(input: PreflightModelInput, context: OperationContext): Promise<Result<ValidationEvidence>>

	// Planning
	createPlan(input: CreatePlanInput, context: OperationContext): Promise<Result<Plan>>
	acceptPlanOutput(input: AcceptPlanOutputInput, context: OperationContext): Promise<Result<AcceptPlanOutputResult>>
	rejectPlanOutput(input: RejectPlanOutputInput, context: OperationContext): Promise<Result<void>>

	// Delivery execution
	/**
	 * V1 Action authorization policy:
	 * - runDeliveryWork records scheduler/runtime Actions with authorized null.
	 * - queueDelivery, retryDeliveryPreflight, shipDelivery, and abandonDelivery record consumer-authorized Actions.
	 * - other consumer-authorized lifecycle/config operations record domain-named AuditStamp fields instead of Actions.
	 */
	/** Requires Delivery Work State not closed. Does not clear preflight-failed. */
	configureDelivery(input: ConfigureDeliveryInput, context: OperationContext): Promise<Result<Delivery>>

	/** Requires Delivery Work State unqueued; records exactly one queue-delivery Action; duplicate calls fail with delivery-work-state-mismatch. */
	queueDelivery(input: QueueDeliveryInput, context: OperationContext): Promise<Result<QueueDeliveryResult>>

	/**
	 * Performs one bounded scheduler step for one available processing slot:
	 * records immediately-ready Actions, starts one eligible Agent Run, or returns
	 * a no-op outcome when the Delivery is schedulable but no work can be performed
	 * in this step. A worked result contains recorded Action IDs and started Agent
	 * Run IDs; failed preflight, validation, and external-operation Actions still
	 * count as worked. Scheduler claims alone do not count as worked. A no-op
	 * result contains no durable Portfolio effects and is returned only for
	 * schedulable Delivery states after preflight passes. no-observed-change is
	 * only for unchanged Review Surface observations; claim-conflict returns after
	 * one failed claim attempt; slice-capacity-full means eligible Slice work exists
	 * but active Slice slots are maxed. It does not wait for Agent Runs, review, human input, or other asynchronous external
	 * state. maxActiveSliceSlots limits active Slice work slots for the Delivery. A
	 * scheduler loop should refetch Delivery/Slice state before each call and call
	 * runDeliveryWork again when capacity remains. Each step atomically claims at
	 * most one Slice work item so concurrent workers cannot repeat the same Slice
	 * work. Delivery-level follow-up work is also claimed atomically when
	 * processed. The claim/lock mechanism is implementation-specific scheduler
	 * coordination and is not modeled as Portfolio data in this sketch. Slice work
	 * is selected in this priority order: needs-delivery-validation,
	 * needs-artifact-validation, awaiting-review observation/merge,
	 * needs-artifact-creation, executable correction, executable initial, then Delivery-level validation/review work
	 * when all Slices are complete. slice-operation-failed and correction-blocked Slices are not schedulable until explicit recovery behavior exists. Within each Slice work bucket,
	 * selection is deterministic: needs-delivery-validation by promotion Action
	 * time; needs-artifact-validation by completed AgentRun time; awaiting-review
	 * by current ReviewSurface created time; executable correction by failed Action
	 * time; executable initial by Slice accepted time; all ties by SliceId.
	 * Successful external operations that change or observe authoritative Delivery
	 * state produce Actions. Failed external operations that produce evidence are
	 * recorded as failure Actions. Delivery preflight runs before every bounded
	 * scheduler pass. Delivery preflight resolves required Delivery Config and
	 * Model selection for the pass as transient scheduler data. Successful Delivery
	 * preflight is normally not stored, except when it supersedes the latest failed
	 * validate-preflight Action. Failed Delivery preflight records a
	 * validate-preflight Action, stops the pass, and returns success with the
	 * failed preflight Action and no Agent Runs. If
	 * Delivery Work State is not needs-artifact-creation, slices-incomplete,
	 * needs-artifact-validation, needs-review-surface, or awaiting-review, runDeliveryWork returns
	 * delivery-work-state-mismatch;
	 * scheduling loops should skip non-schedulable Deliveries. delivery-operation-failed, delivery-validation-failed, and delivery-review-failed are not schedulable until explicit recovery behavior exists. Artifact validation
	 * failures are recorded as validate-* Actions with passed false.
	 */
	runDeliveryWork(input: RunDeliveryWorkInput, context: OperationContext): Promise<Result<RunDeliveryWorkResult>>

	/**
	 * Explicitly retries Delivery preflight for a Delivery whose Delivery Work
	 * State is preflight-failed. Records a validate-preflight Action whose
	 * authorized field is set from the OperationContext because that Action is the
	 * authoritative retry fact; a passed retry supersedes the previous failure by
	 * ordering. Returns delivery-work-state-mismatch if the Delivery Work State is not
	 * preflight-failed.
	 */
	retryDeliveryPreflight(input: RetryDeliveryPreflightInput, context: OperationContext): Promise<Result<RetryDeliveryPreflightResult>>

	// Revision
	openRevisionGate(input: OpenRevisionGateInput, context: OperationContext): Promise<Result<OpenRevisionGateResult>>
	acceptRevisionOutput(input: AcceptRevisionOutputInput, context: OperationContext): Promise<Result<AcceptRevisionOutputResult>>
	closeRevisionGate(input: CloseRevisionGateInput, context: OperationContext): Promise<Result<void>>

	// Delivery close operations
	/** Requires Delivery Work State ready-to-ship; records exactly one ship-delivery Action without post-merge validation in v1; duplicate calls fail with delivery-work-state-mismatch. */
	shipDelivery(input: ShipDeliveryInput, context: OperationContext): Promise<Result<ShipDeliveryResult>>
	/** Requires Delivery Work State not closed; records exactly one abandon-delivery Action after required cleanup evidence is embedded; duplicate calls fail with delivery-work-state-mismatch. */
	abandonDelivery(input: AbandonDeliveryInput, context: OperationContext): Promise<Result<AbandonDeliveryResult>>

	// Project / Repository config
	createProject(input: CreateProjectInput, context: OperationContext): Promise<Result<Project>>
	setProjectConfig(input: SetProjectConfigInput, context: OperationContext): Promise<Result<Project>>
	/** Validates the Project and referenced Secret exist in Portfolio storage, then writes Repository config without calling GitHub. */
	createRepository(input: CreateRepositoryInput, context: OperationContext): Promise<Result<Repository>>
	/** Validates the Repository and referenced Secret exist in Portfolio storage, then writes Repository config without calling GitHub. */
	updateRepositoryConfig(input: UpdateRepositoryConfigInput, context: OperationContext): Promise<Result<Repository>>

	// Secrets
	createSecret(input: CreateSecretInput, context: OperationContext): Promise<Result<Secret>>
	replaceSecret(input: ReplaceSecretInput, context: OperationContext): Promise<Result<Secret>>
	bindSecret(input: BindSecretInput, context: OperationContext): Promise<Result<SecretBinding>>
	archiveSecretBinding(input: ArchiveSecretBindingInput, context: OperationContext): Promise<Result<void>>

	// Snapshot
	exportSnapshot(input: ExportSnapshotInput, context: OperationContext): Promise<Result<PortfolioSnapshotManifest>>
}

export interface SetPortfolioConfigInput {
	/** Creates or updates the retained Portfolio config record; model.defaultModelId is required. */
	config: PortfolioConfig
}

export interface CreateModelProviderInput {
	name: string
	protocol: ModelProviderProtocol
	baseUrl: string
	auth: ModelProviderAuth | null
	headers: ModelProviderHeader[]
}

export interface UpdateModelProviderInput {
	modelProviderId: ModelProviderId
	name: string
	baseUrl: string
	auth: ModelProviderAuth | null
	headers: ModelProviderHeader[]
}

export interface ArchiveModelProviderInput {
	modelProviderId: ModelProviderId
}

export interface UnarchiveModelProviderInput {
	modelProviderId: ModelProviderId
}

export interface CreateModelInput {
	providerId: ModelProviderId
	name: string
	providerModelId: string
}

export interface UpdateModelInput {
	modelId: ModelId
	name: string
}

export interface ArchiveModelInput {
	modelId: ModelId
}

export interface UnarchiveModelInput {
	modelId: ModelId
}

export interface PreflightModelInput {
	modelId: ModelId
}

export interface CreatePlanInput {
	projectId: ProjectId
	title: string

	/** Null or all-null dimensions start with no Plan config record. */
	config: PlanConfig | null
}

export interface AcceptPlanOutputInput {
	planId: PlanId

	/** Proposal shape produced by a planning Agent Run; not stored as a Portfolio artifact. */
	output: PlanOutputProposal
}

export interface AcceptPlanOutputResult {
	deliveries: Delivery[]
	slices: Slice[]
	memories: Memory[]
	links: Link[]
}

export interface RejectPlanOutputInput {
	planId: PlanId
}

export interface ConfigureDeliveryInput {
	deliveryId: DeliveryId

	/** Creates or updates the retained Delivery config record; all-null dimensions store value as null. */
	config: DeliveryConfig
}

export interface QueueDeliveryInput {
	deliveryId: DeliveryId
}

export interface QueueDeliveryResult {
	delivery: Delivery
	action: Action
}

export interface RunDeliveryWorkInput {
	deliveryId: DeliveryId
}

export type RunDeliveryWorkResult =
	/** At least one of actionIds or agentRunIds must be non-empty. */
	{ type: 'worked'; actionIds: ActionId[]; agentRunIds: AgentRunId[] } | { type: 'no-op'; reason: RunDeliveryWorkNoOpReason }

export type RunDeliveryWorkNoOpReason =
	| { type: 'no-eligible-work' }
	| { type: 'slice-capacity-full'; activeSlots: number; maxActiveSliceSlots: number }
	| { type: 'claim-conflict'; work: RunDeliveryWorkClaimConflictWork }
	| { type: 'no-observed-change'; observed: RunDeliveryWorkNoObservedChangeTarget }

export type RunDeliveryWorkClaimConflictWork = { type: 'delivery' } | { type: 'slice'; sliceId: SliceId }

export type RunDeliveryWorkNoObservedChangeTarget =
	| { type: 'slice-review-surface'; sliceId: SliceId; reviewSurfaceId: ReviewSurfaceId }
	| { type: 'delivery-review-surface'; reviewSurfaceId: ReviewSurfaceId }

export interface RetryDeliveryPreflightInput {
	deliveryId: DeliveryId
}

export interface RetryDeliveryPreflightResult {
	delivery: Delivery
	action: Action
}

export interface OpenRevisionGateInput {
	reviewSurfaceId: ReviewSurfaceId
}

export interface OpenRevisionGateResult {
	revisionGate: RevisionGate

	/** Fetched from current Review Surface; not stored as authoritative Portfolio data. */
	feedback: FetchedFeedback[]
}

export interface AcceptRevisionOutputInput {
	revisionGateId: RevisionGateId

	/** Proposal shape produced by a revision-planning Agent Run; not stored as a Portfolio artifact. */
	output: RevisionOutputProposal
}

export interface AcceptRevisionOutputResult {
	revision: Revision
}

export interface CloseRevisionGateInput {
	revisionGateId: RevisionGateId
}

export interface ShipDeliveryInput {
	deliveryId: DeliveryId
}

export interface ShipDeliveryResult {
	delivery: Delivery
	action: Action
}

export interface AbandonDeliveryInput {
	deliveryId: DeliveryId
	reason: string
}

export interface AbandonDeliveryResult {
	delivery: Delivery
	action: Action
}

export interface CreateProjectInput {
	title: string
	source: ProjectSource

	/** Null or all-null dimensions start with no Project config record. */
	config: ProjectConfig | null
}

export interface SetProjectConfigInput {
	projectId: ProjectId

	/** Creates or updates the retained Project config record; all-null dimensions store value as null. */
	config: ProjectConfig
}

export interface CreateRepositoryInput {
	projectId: ProjectId
	config: RepositoryConfig
}

export interface UpdateRepositoryConfigInput {
	repositoryId: RepositoryId
	config: RepositoryConfig
}

export interface CreateSecretInput {
	name: string

	/** Consumer-specific protected value reference. */
	valueRef: string
}

export interface ReplaceSecretInput {
	secretId: SecretId
	valueRef: string
}

export interface BindSecretInput {
	secretId: SecretId
	scope: SecretBindingScope
	envName: string
}

export interface ArchiveSecretBindingInput {
	secretBindingId: SecretBindingId
}

export interface ExportSnapshotInput {
	passphrase: string
}

/**
 * Import creates a new Portfolio storage boundary, so it is not a command on an
 * already-open GorchestraCore instance.
 */
export interface ImportSnapshotInput {
	passphrase: string
	encryptedPayload: Uint8Array
	storage: CoreStorageService
}

export interface ImportSnapshotResult {
	manifest: PortfolioSnapshotManifest
}

export type ImportSnapshotError = InvalidInputError | NotImplementedError

export async function importSnapshot(
	input: ImportSnapshotInput,
	context: OperationContext,
): Promise<Result<ImportSnapshotResult, ImportSnapshotError>> {
	const validation = validateCoreInput(importSnapshotBoundaryPipe, { input, context }, 'snapshot-import', 'importSnapshot')

	if (!validation.ok) {
		return validation
	}

	return Promise.resolve({ ok: false, error: { type: 'not-implemented', operation: 'importSnapshot' } })
}

// -----------------------------------------------------------------------------
// Consumer -> core queries
// -----------------------------------------------------------------------------

export interface CoreQueries {
	getPortfolioConfig(): Promise<Result<PortfolioConfigRecord | null>>

	getProject(id: ProjectId): Promise<Result<Project | null>>
	listProjects(): Promise<Result<Project[]>>

	getRepository(id: RepositoryId): Promise<Result<Repository | null>>
	listRepositories(filter: RepositoryFilter | null): Promise<Result<Repository[]>>

	getModelProvider(id: ModelProviderId): Promise<Result<ModelProvider | null>>
	listModelProviders(filter: ModelProviderFilter | null): Promise<Result<ModelProvider[]>>

	getModel(id: ModelId): Promise<Result<Model | null>>
	listModels(filter: ModelFilter | null): Promise<Result<Model[]>>

	getPlan(id: PlanId): Promise<Result<Plan | null>>
	listPlans(filter: PlanFilter | null): Promise<Result<Plan[]>>

	getDelivery(id: DeliveryId): Promise<Result<Delivery | null>>
	listDeliveries(filter: DeliveryFilter | null): Promise<Result<Delivery[]>>

	getSlice(id: SliceId): Promise<Result<Slice | null>>
	listSlices(deliveryId: DeliveryId): Promise<Result<Slice[]>>

	getReviewSurface(id: ReviewSurfaceId): Promise<Result<ReviewSurface | null>>
	listReviewSurfaces(scope: ReviewSurfaceScope): Promise<Result<ReviewSurface[]>>
	getCurrentReviewSurface(scope: ReviewSurfaceScope): Promise<Result<ReviewSurface | null>>

	getRevision(id: RevisionId): Promise<Result<Revision | null>>
	listRevisions(scope: RevisionScope): Promise<Result<Revision[]>>

	getTimeline(filter: TimelineFilter | null): Promise<Result<TimelineEvent[]>>
}

export interface RepositoryFilter {
	projectId: ProjectId | null
}

export interface ModelProviderFilter {
	archived: boolean | null
}

export interface ModelFilter {
	providerId: ModelProviderId | null
	selectable: boolean | null
}

export interface PlanFilter {
	projectId: ProjectId | null
}

export interface DeliveryFilter {
	projectId: ProjectId | null
	closed: 'open' | 'shipped' | 'abandoned' | null
}

export interface TimelineFilter {
	deliveryId: DeliveryId | null
	sliceId: SliceId | null
	since: IsoDateTime | null
	until: IsoDateTime | null
}

export interface TimelineEvent {
	occurredAt: IsoDateTime
	eventType: string
	summary: string
}

// -----------------------------------------------------------------------------
// Core Services
// -----------------------------------------------------------------------------

/**
 * Consumer-provided deployment mechanics. Core-owned source-control providers,
 * Model Provider Protocol adapters, Model Agent runtime orchestration, and
 * Snapshot encryption are intentionally not public service boundaries.
 */

export interface CoreStorageService {
	transaction<T>(fn: (tx: CoreStorageTransaction) => Promise<T>): Promise<T>
}

export type CoreStorage = CoreStorageService

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

export interface CoreSecretsService {
	resolveSecrets(input: ResolveSecretsInput): Promise<ResolvedSecret[]>
	resolveSecretValues(input: ResolveSecretValuesInput): Promise<ResolvedSecretValue[]>
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

/**
 * Sandbox capabilities are deployment-specific and consumed by Core-owned Agent
 * Run orchestration. The current stub validates only that a sandbox service
 * object is present.
 */
export interface CoreSandboxService {
	[capability: string]: unknown
}

// -----------------------------------------------------------------------------
// Event sink / logger
// -----------------------------------------------------------------------------

export interface CoreEventSink {
	publish(event: CoreEvent): void
}

export type CoreEvent =
	| { type: 'delivery-updated'; deliveryId: DeliveryId }
	| { type: 'slice-updated'; sliceId: SliceId }
	| { type: 'delivery-work-run'; deliveryId: DeliveryId }
	| { type: 'agent-run-started'; agentRunId: AgentRunId }
	| { type: 'review-surface-created'; reviewSurfaceId: ReviewSurfaceId }
	| { type: 'revision-gate-opened'; revisionGateId: RevisionGateId }

export interface CoreLogger {
	debug(message: string, context: Record<string, unknown> | null): void
	info(message: string, context: Record<string, unknown> | null): void
	warn(message: string, context: Record<string, unknown> | null): void
	error(message: string, context: Record<string, unknown> | null): void
}

// -----------------------------------------------------------------------------
// Consumer -> core input validation
// -----------------------------------------------------------------------------

type AnyFunction = (...args: never[]) => unknown

const functionDependencyPipe = v
	.any<unknown>()
	.pipe(v.custom<unknown>((value) => typeof value === 'function', 'Expected a function dependency.')) as Pipe<unknown, AnyFunction>

const rawStringPipe = v.string()
const nonEmptyRawStringPipe = v.string().pipe(v.min(1, 'Expected a non-empty string.'))
const trimmedStringPipe = v.string().pipe(v.asTrimmed())
const nonEmptyTrimmedStringPipe = trimmedStringPipe.pipe(v.min(1, 'Expected a non-empty string.'))
const freeFormStringPipe = trimmedStringPipe
const brandedIdPipe = nonEmptyTrimmedStringPipe
const nullableBrandedIdPipe = v.nullable(brandedIdPipe)
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

const storagePipe = v.object({ transaction: functionDependencyPipe })
const coreSecretsServicePipe = v.object({
	resolveSecrets: functionDependencyPipe,
	resolveSecretValues: functionDependencyPipe,
})
const coreSandboxServicePipe = v.object({})
const coreEventSinkPipe = v.object({ publish: functionDependencyPipe })
const coreLoggerPipe = v.object({
	debug: functionDependencyPipe,
	info: functionDependencyPipe,
	warn: functionDependencyPipe,
	error: functionDependencyPipe,
})
const optionalCoreEventSinkPipe = v
	.any<unknown>()
	.pipe(
		v.custom<unknown>(
			(value) => value === undefined || acceptsPipe(coreEventSinkPipe, value),
			'Expected a Core Event Sink service when provided.',
		),
	) as Pipe<unknown, CoreEventSink | undefined>
const optionalCoreLoggerPipe = v
	.any<unknown>()
	.pipe(
		v.custom<unknown>(
			(value) => value === undefined || acceptsPipe(coreLoggerPipe, value),
			'Expected a Core Logger service when provided.',
		),
	) as Pipe<unknown, CoreLogger | undefined>
const openCoreOptionsPipe = v.object({
	storage: storagePipe,
	secrets: coreSecretsServicePipe,
	sandbox: coreSandboxServicePipe,
	clock: v.object({ now: functionDependencyPipe }),
	idGenerator: v.object({ next: functionDependencyPipe }),
	logger: optionalCoreLoggerPipe,
	eventSink: optionalCoreEventSinkPipe,
})

const localActorRefPipe = v.object({ type: rawStringPipe, id: rawStringPipe })
const operationContextPipe = v.object({ actor: localActorRefPipe, correlationId: v.nullable(rawStringPipe) })
const importSnapshotInputPipe = v.object({
	passphrase: nonEmptyRawStringPipe,
	encryptedPayload: v.instanceOf(Uint8Array, 'Expected a Uint8Array encrypted snapshot payload.'),
	storage: storagePipe,
})
const importSnapshotBoundaryPipe = v.object({ input: importSnapshotInputPipe, context: operationContextPipe })

const modelProviderProtocolPipe = enumStringPipe(['anthropic-messages', 'openai-responses', 'openai-completions', 'google-generative-ai'])
const modelProviderAuthPipe = v.discriminate(discriminator, {
	apiKey: v.object({ type: v.eq('apiKey'), secretId: brandedIdPipe }),
})
const modelProviderHeaderPipe = v.object({ name: headerNamePipe, valueSecretId: brandedIdPipe })
const deliveryWorkConfigPipe = v.object({
	maxActiveSliceSlots: positiveIntegerPipe,
	maxCorrectionRetriesPerFailure: nonNegativeIntegerPipe,
	modelTimeoutMs: positiveIntegerPipe,
})
const projectModelConfigPipe = v.object({
	planningModelId: nullableBrandedIdPipe,
	revisionPlanningModelId: nullableBrandedIdPipe,
	executionModelId: nullableBrandedIdPipe,
	revisionExecutionModelId: nullableBrandedIdPipe,
})
const portfolioModelConfigPipe = v.object({
	defaultModelId: brandedIdPipe,
	planningModelId: nullableBrandedIdPipe,
	revisionPlanningModelId: nullableBrandedIdPipe,
	executionModelId: nullableBrandedIdPipe,
	revisionExecutionModelId: nullableBrandedIdPipe,
})
const planModelConfigPipe = v.object({ planningModelId: nullableBrandedIdPipe })
const deliveryModelConfigPipe = v.object({
	revisionPlanningModelId: nullableBrandedIdPipe,
	executionModelId: nullableBrandedIdPipe,
	revisionExecutionModelId: nullableBrandedIdPipe,
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
		secretId: brandedIdPipe,
	}),
})
const proposedDeliveryTargetPipe = v.discriminate(discriminator, {
	'source-control': v.object({
		type: v.eq('source-control'),
		repositoryId: brandedIdPipe,
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
	dependsOnDeliveryIds: v.array(brandedIdPipe),
})
const memoryTypePipe = enumStringPipe(['decision', 'fact', 'constraint', 'assumption', 'risk', 'architecture', 'workflow', 'convention'])
const proposedMemoryPipe = v.object({
	proposedMemoryKey: nonEmptyTrimmedStringPipe,
	title: nonEmptyTrimmedStringPipe,
	body: freeFormStringPipe,
	type: v.nullable(memoryTypePipe),
})
const graphNodeRefPipe = v.discriminate(discriminator, {
	plan: v.object({ type: v.eq('plan'), id: brandedIdPipe }),
	project: v.object({ type: v.eq('project'), id: brandedIdPipe }),
	delivery: v.object({ type: v.eq('delivery'), id: brandedIdPipe }),
	slice: v.object({ type: v.eq('slice'), id: brandedIdPipe }),
	memory: v.object({ type: v.eq('memory'), id: brandedIdPipe }),
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
	project: v.object({ type: v.eq('project'), projectId: brandedIdPipe }),
	delivery: v.object({ type: v.eq('delivery'), deliveryId: brandedIdPipe }),
})
const reviewSurfaceScopePipe = v.discriminate(discriminator, {
	slice: v.object({ type: v.eq('slice'), sliceId: brandedIdPipe, sliceArtifactId: brandedIdPipe }),
	delivery: v.object({ type: v.eq('delivery'), deliveryId: brandedIdPipe, deliveryArtifactId: brandedIdPipe }),
})
const revisionScopePipe = v.discriminate(discriminator, {
	'slice-artifact': v.object({ type: v.eq('slice-artifact'), sliceId: brandedIdPipe, sliceArtifactId: brandedIdPipe }),
	'delivery-artifact': v.object({
		type: v.eq('delivery-artifact'),
		deliveryId: brandedIdPipe,
		deliveryArtifactId: brandedIdPipe,
	}),
})
const repositoryFilterPipe = v.object({ projectId: nullableBrandedIdPipe })
const modelProviderFilterPipe = v.object({ archived: v.nullable(v.boolean()) })
const modelFilterPipe = v.object({ providerId: nullableBrandedIdPipe, selectable: v.nullable(v.boolean()) })
const planFilterPipe = v.object({ projectId: nullableBrandedIdPipe })
const deliveryFilterPipe = v.object({
	projectId: nullableBrandedIdPipe,
	closed: v.nullable(enumStringPipe(['open', 'shipped', 'abandoned'])),
})
const timelineFilterPipe = v.object({
	deliveryId: nullableBrandedIdPipe,
	sliceId: nullableBrandedIdPipe,
	since: v.nullable(rawStringPipe),
	until: v.nullable(rawStringPipe),
})

const commandInputPipes = {
	setPortfolioConfig: v.object({ config: portfolioConfigPipe }),
	createModelProvider: v.object({
		name: nonEmptyTrimmedStringPipe,
		protocol: modelProviderProtocolPipe,
		baseUrl: modelProviderBaseUrlPipe,
		auth: v.nullable(modelProviderAuthPipe),
		headers: v.array(modelProviderHeaderPipe),
	}),
	updateModelProvider: v.object({
		modelProviderId: brandedIdPipe,
		name: nonEmptyTrimmedStringPipe,
		baseUrl: modelProviderBaseUrlPipe,
		auth: v.nullable(modelProviderAuthPipe),
		headers: v.array(modelProviderHeaderPipe),
	}),
	archiveModelProvider: v.object({ modelProviderId: brandedIdPipe }),
	unarchiveModelProvider: v.object({ modelProviderId: brandedIdPipe }),
	createModel: v.object({
		providerId: brandedIdPipe,
		name: nonEmptyTrimmedStringPipe,
		providerModelId: nonEmptyTrimmedStringPipe,
	}),
	updateModel: v.object({ modelId: brandedIdPipe, name: nonEmptyTrimmedStringPipe }),
	archiveModel: v.object({ modelId: brandedIdPipe }),
	unarchiveModel: v.object({ modelId: brandedIdPipe }),
	preflightModel: v.object({ modelId: brandedIdPipe }),
	createPlan: v.object({
		projectId: brandedIdPipe,
		title: nonEmptyTrimmedStringPipe,
		config: v.nullable(planConfigPipe),
	}),
	acceptPlanOutput: v.object({ planId: brandedIdPipe, output: planOutputProposalPipe }),
	rejectPlanOutput: v.object({ planId: brandedIdPipe }),
	configureDelivery: v.object({ deliveryId: brandedIdPipe, config: deliveryConfigPipe }),
	queueDelivery: v.object({ deliveryId: brandedIdPipe }),
	runDeliveryWork: v.object({ deliveryId: brandedIdPipe }),
	retryDeliveryPreflight: v.object({ deliveryId: brandedIdPipe }),
	openRevisionGate: v.object({ reviewSurfaceId: brandedIdPipe }),
	acceptRevisionOutput: v.object({ revisionGateId: brandedIdPipe, output: revisionOutputProposalPipe }),
	closeRevisionGate: v.object({ revisionGateId: brandedIdPipe }),
	shipDelivery: v.object({ deliveryId: brandedIdPipe }),
	abandonDelivery: v.object({ deliveryId: brandedIdPipe, reason: freeFormStringPipe }),
	createProject: v.object({
		title: nonEmptyTrimmedStringPipe,
		source: projectSourcePipe,
		config: v.nullable(projectConfigPipe),
	}),
	setProjectConfig: v.object({ projectId: brandedIdPipe, config: projectConfigPipe }),
	createRepository: v.object({ projectId: brandedIdPipe, config: repositoryConfigPipe }),
	updateRepositoryConfig: v.object({ repositoryId: brandedIdPipe, config: repositoryConfigPipe }),
	createSecret: v.object({ name: nonEmptyTrimmedStringPipe, valueRef: secretValueRefPipe }),
	replaceSecret: v.object({ secretId: brandedIdPipe, valueRef: secretValueRefPipe }),
	bindSecret: v.object({ secretId: brandedIdPipe, scope: secretBindingScopePipe, envName: envNamePipe }),
	archiveSecretBinding: v.object({ secretBindingId: brandedIdPipe }),
	exportSnapshot: v.object({ passphrase: nonEmptyRawStringPipe }),
} satisfies Record<keyof CoreCommands, Pipe<unknown, unknown>>

const queryArgumentPipes = {
	getPortfolioConfig: argumentTuplePipe([]),
	getProject: argumentTuplePipe([brandedIdPipe]),
	listProjects: argumentTuplePipe([]),
	getRepository: argumentTuplePipe([brandedIdPipe]),
	listRepositories: argumentTuplePipe([v.nullable(repositoryFilterPipe)]),
	getModelProvider: argumentTuplePipe([brandedIdPipe]),
	listModelProviders: argumentTuplePipe([v.nullable(modelProviderFilterPipe)]),
	getModel: argumentTuplePipe([brandedIdPipe]),
	listModels: argumentTuplePipe([v.nullable(modelFilterPipe)]),
	getPlan: argumentTuplePipe([brandedIdPipe]),
	listPlans: argumentTuplePipe([v.nullable(planFilterPipe)]),
	getDelivery: argumentTuplePipe([brandedIdPipe]),
	listDeliveries: argumentTuplePipe([v.nullable(deliveryFilterPipe)]),
	getSlice: argumentTuplePipe([brandedIdPipe]),
	listSlices: argumentTuplePipe([brandedIdPipe]),
	getReviewSurface: argumentTuplePipe([brandedIdPipe]),
	listReviewSurfaces: argumentTuplePipe([reviewSurfaceScopePipe]),
	getCurrentReviewSurface: argumentTuplePipe([reviewSurfaceScopePipe]),
	getRevision: argumentTuplePipe([brandedIdPipe]),
	listRevisions: argumentTuplePipe([revisionScopePipe]),
	getTimeline: argumentTuplePipe([v.nullable(timelineFilterPipe)]),
} satisfies Record<keyof CoreQueries, Pipe<unknown, unknown>>

function acceptsPipe(pipe: Pipe<unknown, unknown>, value: unknown): boolean {
	return v.validate(pipe, value).valid
}

function argumentTuplePipe(branches: Pipe<unknown, unknown>[]): Pipe<unknown, unknown> {
	return v
		.array(v.any<unknown>())
		.pipe(v.has(branches.length, `Expected exactly ${branches.length} query argument(s).`))
		.pipe(v.tuple(branches))
}

function enumStringPipe<const Values extends readonly [string, ...string[]]>(values: Values): Pipe<unknown, Values[number]> {
	return v.string().pipe(v.in(values, `Expected one of: ${values.join(', ')}.`))
}

function discriminator(value: unknown): PropertyKey {
	return isRecord(value) ? (value['type'] as PropertyKey) : ''
}

function discriminatorFrom(field: string): (value: unknown) => PropertyKey {
	return (value) => (isRecord(value) ? (value[field] as PropertyKey) : '')
}

// -----------------------------------------------------------------------------
// Runtime stub implementation
// -----------------------------------------------------------------------------

function createCoreCommands(): CoreCommands {
	return {
		setPortfolioConfig(input, context) {
			return commandStub<PortfolioConfigRecord>('setPortfolioConfig', input, context)
		},
		createModelProvider(input, context) {
			return commandStub<ModelProvider>('createModelProvider', input, context)
		},
		updateModelProvider(input, context) {
			return commandStub<ModelProvider>('updateModelProvider', input, context)
		},
		archiveModelProvider(input, context) {
			return commandStub<ModelProvider>('archiveModelProvider', input, context)
		},
		unarchiveModelProvider(input, context) {
			return commandStub<ModelProvider>('unarchiveModelProvider', input, context)
		},
		createModel(input, context) {
			return commandStub<Model>('createModel', input, context)
		},
		updateModel(input, context) {
			return commandStub<Model>('updateModel', input, context)
		},
		archiveModel(input, context) {
			return commandStub<Model>('archiveModel', input, context)
		},
		unarchiveModel(input, context) {
			return commandStub<Model>('unarchiveModel', input, context)
		},
		preflightModel(input, context) {
			return commandStub<ValidationEvidence>('preflightModel', input, context)
		},
		createPlan(input, context) {
			return commandStub<Plan>('createPlan', input, context)
		},
		acceptPlanOutput(input, context) {
			return commandStub<AcceptPlanOutputResult>('acceptPlanOutput', input, context)
		},
		rejectPlanOutput(input, context) {
			return commandStub<void>('rejectPlanOutput', input, context)
		},
		configureDelivery(input, context) {
			return commandStub<Delivery>('configureDelivery', input, context)
		},
		queueDelivery(input, context) {
			return commandStub<QueueDeliveryResult>('queueDelivery', input, context)
		},
		runDeliveryWork(input, context) {
			return commandStub<RunDeliveryWorkResult>('runDeliveryWork', input, context)
		},
		retryDeliveryPreflight(input, context) {
			return commandStub<RetryDeliveryPreflightResult>('retryDeliveryPreflight', input, context)
		},
		openRevisionGate(input, context) {
			return commandStub<OpenRevisionGateResult>('openRevisionGate', input, context)
		},
		acceptRevisionOutput(input, context) {
			return commandStub<AcceptRevisionOutputResult>('acceptRevisionOutput', input, context)
		},
		closeRevisionGate(input, context) {
			return commandStub<void>('closeRevisionGate', input, context)
		},
		shipDelivery(input, context) {
			return commandStub<ShipDeliveryResult>('shipDelivery', input, context)
		},
		abandonDelivery(input, context) {
			return commandStub<AbandonDeliveryResult>('abandonDelivery', input, context)
		},
		createProject(input, context) {
			return commandStub<Project>('createProject', input, context)
		},
		setProjectConfig(input, context) {
			return commandStub<Project>('setProjectConfig', input, context)
		},
		createRepository(input, context) {
			return commandStub<Repository>('createRepository', input, context)
		},
		updateRepositoryConfig(input, context) {
			return commandStub<Repository>('updateRepositoryConfig', input, context)
		},
		createSecret(input, context) {
			return commandStub<Secret>('createSecret', input, context)
		},
		replaceSecret(input, context) {
			return commandStub<Secret>('replaceSecret', input, context)
		},
		bindSecret(input, context) {
			return commandStub<SecretBinding>('bindSecret', input, context)
		},
		archiveSecretBinding(input, context) {
			return commandStub<void>('archiveSecretBinding', input, context)
		},
		exportSnapshot(input, context) {
			return commandStub<PortfolioSnapshotManifest>('exportSnapshot', input, context)
		},
	}
}

function createCoreQueries(): CoreQueries {
	return {
		getPortfolioConfig: (...args: unknown[]) => queryStub<PortfolioConfigRecord | null>('getPortfolioConfig', args),
		getProject: (...args: unknown[]) => queryStub<Project | null>('getProject', args),
		listProjects: (...args: unknown[]) => queryStub<Project[]>('listProjects', args),
		getRepository: (...args: unknown[]) => queryStub<Repository | null>('getRepository', args),
		listRepositories: (...args: unknown[]) => queryStub<Repository[]>('listRepositories', args),
		getModelProvider: (...args: unknown[]) => queryStub<ModelProvider | null>('getModelProvider', args),
		listModelProviders: (...args: unknown[]) => queryStub<ModelProvider[]>('listModelProviders', args),
		getModel: (...args: unknown[]) => queryStub<Model | null>('getModel', args),
		listModels: (...args: unknown[]) => queryStub<Model[]>('listModels', args),
		getPlan: (...args: unknown[]) => queryStub<Plan | null>('getPlan', args),
		listPlans: (...args: unknown[]) => queryStub<Plan[]>('listPlans', args),
		getDelivery: (...args: unknown[]) => queryStub<Delivery | null>('getDelivery', args),
		listDeliveries: (...args: unknown[]) => queryStub<Delivery[]>('listDeliveries', args),
		getSlice: (...args: unknown[]) => queryStub<Slice | null>('getSlice', args),
		listSlices: (...args: unknown[]) => queryStub<Slice[]>('listSlices', args),
		getReviewSurface: (...args: unknown[]) => queryStub<ReviewSurface | null>('getReviewSurface', args),
		listReviewSurfaces: (...args: unknown[]) => queryStub<ReviewSurface[]>('listReviewSurfaces', args),
		getCurrentReviewSurface: (...args: unknown[]) => queryStub<ReviewSurface | null>('getCurrentReviewSurface', args),
		getRevision: (...args: unknown[]) => queryStub<Revision | null>('getRevision', args),
		listRevisions: (...args: unknown[]) => queryStub<Revision[]>('listRevisions', args),
		getTimeline: (...args: unknown[]) => queryStub<TimelineEvent[]>('getTimeline', args),
	}
}

function commandStub<T>(operation: keyof CoreCommands, input: unknown, context: unknown): Promise<Result<T>> {
	const validation = validateCoreInput(
		v.object({ input: commandInputPipes[operation], context: operationContextPipe }),
		{ input, context },
		'command',
		operation,
	)

	if (!validation.ok) {
		return Promise.resolve(validation)
	}

	return Promise.resolve(notImplemented<T>(operation))
}

function queryStub<T>(operation: keyof CoreQueries, args: unknown[]): Promise<Result<T>> {
	const validation = validateCoreInput(v.object({ args: queryArgumentPipes[operation] }), { args }, 'query', operation)

	if (!validation.ok) {
		return Promise.resolve(validation)
	}

	return Promise.resolve(notImplemented<T>(operation))
}

function validateCoreInput<TPipe extends Pipe<unknown, unknown>>(
	pipe: TPipe,
	value: unknown,
	boundary: CoreInputBoundary,
	operation: string,
): Result<PipeOutput<TPipe>, InvalidInputError> {
	const result = v.validate(pipe, value)

	if (!result.valid) {
		return { ok: false, error: { type: 'invalid-input', boundary, operation, pipeError: result.error } }
	}

	return { ok: true, value: result.value }
}

function notImplemented<T>(operation: string): Result<T> {
	return { ok: false, error: { type: 'not-implemented', operation } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
