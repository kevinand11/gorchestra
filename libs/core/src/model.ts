/*
 * Gorchestra core domain model sketch.
 *
 * This file is documentation-by-type, not an implementation schema yet.
 * It captures the current core domain language from docs/core/CONTEXT.md and ADRs.
 * Consumers own authorization and app tenancy; core is opened inside one Portfolio.
 */

// -----------------------------------------------------------------------------
// Common primitives
// -----------------------------------------------------------------------------

export type Brand<T, Name extends string> = T & { readonly __brand: Name }

export type ProjectId = Brand<string, 'ProjectId'>
export type RepositoryId = Brand<string, 'RepositoryId'>
export type PlanId = Brand<string, 'PlanId'>
export type DeliveryId = Brand<string, 'DeliveryId'>
export type SliceId = Brand<string, 'SliceId'>
export type MemoryId = Brand<string, 'MemoryId'>
export type LinkId = Brand<string, 'LinkId'>
export type SecretId = Brand<string, 'SecretId'>
export type SecretBindingId = Brand<string, 'SecretBindingId'>
export type ActionId = Brand<string, 'ActionId'>
export type AgentRunId = Brand<string, 'AgentRunId'>
export type RevisionGateId = Brand<string, 'RevisionGateId'>
export type RevisionId = Brand<string, 'RevisionId'>
export type ReviewSurfaceId = Brand<string, 'ReviewSurfaceId'>
export type DeliveryArtifactId = Brand<string, 'DeliveryArtifactId'>
export type SliceArtifactId = Brand<string, 'SliceArtifactId'>
export type SnapshotId = Brand<string, 'SnapshotId'>
export type ModelProviderId = Brand<string, 'ModelProviderId'>
export type ModelId = Brand<string, 'ModelId'>

export type IsoDateTime = string

/**
 * Unless explicitly noted otherwise:
 * - user-facing names/titles and provider-facing string identifiers are stored
 *   trimmed and must be non-empty.
 * - free-form bodies/details are stored trimmed and may be empty.
 * - collections are stored as arrays; empty arrays mean no items.
 * - operation-specific reasons, when needed, live on the specific closed state,
 *   result, or input they explain and are stored as strings that may be empty.
 * - use field: RuntimeRecord for runtime lifecycle timestamps, direct
 *   domain-named AuditStamp fields for consumer-authorized operations, and
 *   domain-specific embedded records when a lifecycle moment has additional
 *   fields. Delivery state transitions that must appear in the Delivery Action
 *   timeline are represented as Actions with non-null authorized instead of
 *   direct Delivery lifecycle fields. Embedded records contain all fields that
 *   change atomically with that lifecycle moment so half-updated states are not
 *   representable.
 */

export interface LocalActorRef {
	/** Consumer-defined actor category, such as "workspace-member" or "local-user". */
	type: string

	/** Consumer-local actor identifier. Core stores this opaquely and never interprets it. */
	id: string
}

export type AuditStamp = LocalAuditStamp | ImportedAuditStamp

export interface LocalAuditStamp {
	origin: 'local'
	at: IsoDateTime
	actor: LocalActorRef
	correlationId: string | null
}

export interface ImportedAuditStamp {
	origin: 'imported'

	/** Original operation time copied from the imported audit stamp. */
	at: IsoDateTime
}

export interface RuntimeRecord {
	at: IsoDateTime
}

// -----------------------------------------------------------------------------
// Project / Project Source
// -----------------------------------------------------------------------------

export interface Project {
	id: ProjectId
	title: string
	/** Immutable after Project creation. */
	source: ProjectSource
	/** Starts null; once created by a config setter, the record is retained and value may be cleared to null. */
	config: ProjectConfigRecord | null
	created: AuditStamp
}

export type ProjectSource = SourceControlProjectSource

export interface SourceControlProjectSource {
	type: 'source-control'
}

// -----------------------------------------------------------------------------
// Repository
// -----------------------------------------------------------------------------

export interface Repository {
	id: RepositoryId
	projectId: ProjectId
	config: RepositoryConfig
	created: AuditStamp
}

export type RepositoryConfig = GitHubRepositoryConfig

export interface GitHubRepositoryConfig {
	provider: 'github'
	owner: string
	name: string
}

// -----------------------------------------------------------------------------
// Model Providers / Models / Config
// -----------------------------------------------------------------------------

export interface ModelProvider {
	id: ModelProviderId
	name: string
	protocol: ModelProviderProtocol

	/** Full API base URL; trailing slashes are trimmed. Must be https, except localhost/127.0.0.1 may use http. */
	baseUrl: string

	/** Standard auth used by the protocol adapter; null means no standard auth. */
	auth: ModelProviderAuth | null

	headers: ModelProviderHeader[]
	created: AuditStamp
	updated: AuditStamp | null
	archived: AuditStamp | null
}

export type ModelProviderProtocol = 'anthropic-messages' | 'openai-responses' | 'openai-completions' | 'google-generative-ai'

export type ModelProviderAuth = ModelProviderApiKeyAuth

export interface ModelProviderApiKeyAuth {
	type: 'apiKey'

	/** Must reference a generic Secret. */
	secretId: SecretId
}

export interface ModelProviderHeader {
	/** Must match /^[A-Za-z0-9-]+$/; unique per provider case-insensitively. */
	name: string

	/** Must reference a generic Secret. */
	valueSecretId: SecretId
}

export interface Model {
	id: ModelId
	providerId: ModelProviderId
	name: string
	providerModelId: string
	created: AuditStamp
	updated: AuditStamp | null
	archived: AuditStamp | null
}

/**
 * Config normalization:
 * - createProject/createPlan store config: null when input config is null or all dimensions fold to null.
 * - setPortfolioConfig requires model.defaultModelId.
 * - setProjectConfig/configureDelivery retain the config record; if all dimensions fold to null, record.value is null.
 * - Empty/all-null nested config dimensions fold to null.
 */
export interface PortfolioConfigRecord {
	configured: AuditStamp
	value: PortfolioConfig
}

export interface PortfolioConfig {
	model: PortfolioModelConfig
	work: DeliveryWorkConfig | null
}

export interface ProjectConfigRecord {
	configured: AuditStamp
	value: ProjectConfig | null
}

export interface ProjectConfig {
	model: ProjectModelConfig | null
	work: DeliveryWorkConfig | null
}

export interface PlanConfigRecord {
	configured: AuditStamp
	value: PlanConfig | null
}

export interface PlanConfig {
	model: PlanModelConfig | null
}

export interface PortfolioModelConfig extends ProjectModelConfig {
	defaultModelId: ModelId
}

export interface ProjectModelConfig {
	planningModelId: ModelId | null
	revisionPlanningModelId: ModelId | null
	executionModelId: ModelId | null
	revisionExecutionModelId: ModelId | null
}

export interface PlanModelConfig {
	planningModelId: ModelId | null
}

export interface DeliveryModelConfig {
	revisionPlanningModelId: ModelId | null
	executionModelId: ModelId | null
	revisionExecutionModelId: ModelId | null
}

/**
 * Effective Agent Run model selection is derived, not stored separately.
 * Null config records, null values, and null model dimensions are skipped.
 * Portfolio model config is never null when Portfolio config exists because it
 * must include defaultModelId.
 *
 * planning:
 *   Plan.config.value.model.planningModelId
 *   -> Project.config.value.model.planningModelId
 *   -> PortfolioConfigRecord.value.model.planningModelId
 *   -> PortfolioConfigRecord.value.model.defaultModelId
 *
 * revision-planning:
 *   Delivery.config.value.model.revisionPlanningModelId
 *   -> Project.config.value.model.revisionPlanningModelId
 *   -> PortfolioConfigRecord.value.model.revisionPlanningModelId
 *   -> PortfolioConfigRecord.value.model.defaultModelId
 *
 * execution:
 *   Delivery.config.value.model.executionModelId
 *   -> Project.config.value.model.executionModelId
 *   -> PortfolioConfigRecord.value.model.executionModelId
 *   -> PortfolioConfigRecord.value.model.defaultModelId
 *
 * revision-execution:
 *   Delivery.config.value.model.revisionExecutionModelId
 *   -> Project.config.value.model.revisionExecutionModelId
 *   -> PortfolioConfigRecord.value.model.revisionExecutionModelId
 *   -> PortfolioConfigRecord.value.model.defaultModelId
 */
export type AgentRunModelResolution = {
	purpose: AgentRunPurpose['type']
	selectedModelId: ModelId
}

// -----------------------------------------------------------------------------
// Plan / Plan Output proposal shape
// -----------------------------------------------------------------------------

export interface Plan {
	id: PlanId
	projectId: ProjectId
	title: string
	/** Immutable after Plan creation; null means the Plan has no Plan-level config. */
	config: PlanConfigRecord | null
	created: AuditStamp
}

/**
 * PlanOutputProposal is not a stored Portfolio artifact.
 * It is the structured shape a planning Agent Run must produce.
 * Accepting it materializes Deliveries, Slices, Memories, Links, and Slice Instruction Sources.
 */
export interface PlanOutputProposal {
	proposedDeliveries: ProposedDelivery[]
	proposedMemories: ProposedMemory[]
	proposedLinks: ProposedLink[]
}

export interface ProposedDelivery {
	proposedDeliveryKey: string
	title: string
	target: ProposedDeliveryTarget
	slices: ProposedSlice[]
	dependsOnDeliveryIds: DeliveryId[]
}

export type ProposedDeliveryTarget = ProposedSourceControlDeliveryTarget

export interface ProposedSourceControlDeliveryTarget {
	type: 'source-control'
	repositoryId: RepositoryId

	/** Immutable after Delivery acceptance. */
	targetBranch: string
}

export interface ProposedSlice {
	proposedSliceKey: string
	title: string

	/** Becomes the materialized Slice's immutable Instruction Source. */
	instruction: InstructionSource

	/** Same-Delivery dependencies only. */
	dependsOnProposedSliceKeys: string[]
}

export interface ProposedMemory {
	proposedMemoryKey: string
	title: string
	body: string
	type: MemoryType | null
}

export interface ProposedLink {
	type: LinkType
	from: ProposedGraphRef
	to: ProposedGraphRef
}

export type ProposedGraphRef =
	| { type: 'existing'; node: GraphNodeRef }
	| { type: 'proposed-delivery'; proposedDeliveryKey: string }
	| { type: 'proposed-slice'; proposedSliceKey: string }
	| { type: 'proposed-memory'; proposedMemoryKey: string }

// -----------------------------------------------------------------------------
// Instruction Source
// -----------------------------------------------------------------------------

export interface InstructionSource {
	/** Immutable accepted instructions used by Agent Runs. */
	body: string
}

// -----------------------------------------------------------------------------
// Delivery / Slice
// -----------------------------------------------------------------------------

export interface Delivery {
	id: DeliveryId
	projectId: ProjectId
	planId: PlanId
	title: string
	target: DeliveryTarget
	/** Starts null; once created by configureDelivery, the record is retained and value may be cleared to null. */
	config: DeliveryConfigRecord | null

	/** Every Delivery has at least one Slice. */
	sliceIds: readonly [SliceId, ...SliceId[]]

	accepted: AuditStamp
}

export type DeliveryClosedOutcome = 'shipped' | 'abandoned'

export interface DeliveryConfigRecord {
	configured: AuditStamp
	value: DeliveryConfig | null
}

export interface DeliveryConfig {
	/** Null means no Delivery-level Agent Run override; inherit from outer scopes. */
	model: DeliveryModelConfig | null

	/** Null means no Delivery-level work override; inherit from outer scopes. */
	work: DeliveryWorkConfig | null
}

/**
 * Derived in priority order: closed, unqueued, dependency-blocked,
 * preflight-failed, needs-artifact-creation, slices-incomplete,
 * delivery-operation-failed, delivery-validation-failed, delivery-review-failed,
 * needs-artifact-validation, needs-review-surface, awaiting-review, then
 * ready-to-ship.
 */
export type DeliveryWorkState =
	| { type: 'closed'; outcome: DeliveryClosedOutcome; actionId: ActionId }
	| { type: 'unqueued' }
	/** blockedBy contains direct unmet Delivery dependencies only, ordered by dependency accepted time then DeliveryId. */
	| { type: 'dependency-blocked'; blockedBy: DeliveryId[] }
	| { type: 'preflight-failed'; actionId: ActionId }
	/** Delivery is queued and unblocked, but its Delivery Artifact has not been created yet. */
	| { type: 'needs-artifact-creation' }
	/** At least one Slice is not complete; detailed per-Slice state comes from SliceWorkState. */
	| { type: 'slices-incomplete' }
	/** Latest Delivery-scoped external operation failed; explicit manual retry/recovery operation will be added later. */
	| { type: 'delivery-operation-failed'; actionId: ActionId }
	/** Latest Delivery-level artifact validation failed; Delivery-level correction behavior is deferred. */
	| { type: 'delivery-validation-failed'; actionId: ActionId }
	/** Current Delivery Review Surface closed without merge; exact Delivery-level correction behavior is deferred. */
	| { type: 'delivery-review-failed'; reviewSurfaceId: ReviewSurfaceId }
	/** All Slices are complete; Delivery Artifact needs Delivery-level validation before review/ship flow can continue. */
	| { type: 'needs-artifact-validation' }
	/** Delivery Artifact validation passed and Delivery Review Surface still needs to be created. */
	| { type: 'needs-review-surface' }
	/** Delivery Review Surface exists and is waiting for external review, merge, or observation. */
	| { type: 'awaiting-review'; reviewSurfaceId: ReviewSurfaceId }
	/** Delivery Branch is integrated into the Target Branch; Delivery can be shipped by shipDelivery. */
	| { type: 'ready-to-ship'; integration: DeliveryIntegration }

export type DeliveryIntegration =
	| { type: 'review-surface-merged'; reviewSurfaceId: ReviewSurfaceId }
	| { type: 'observed-artifact-integration'; actionId: ActionId }

export interface DeliveryWorkConfig {
	/** Must be >= 1. Limits active Slice work slots: executing, needs-artifact-validation, needs-delivery-validation, and unexpired scheduler claims, including claims for Slice Artifact creation. Unclaimed needs-artifact-creation and external waiting states do not count. */
	maxActiveSliceSlots: number

	/** Must be >= 0. Counts automatic correction Agent Runs per validation/external-operation failure chain. */
	maxCorrectionRetriesPerFailure: number

	/** Must be >= 1. Applies only to Model Agent work; future Agent types get separate timeout fields. */
	modelTimeoutMs: number
}

/**
 * Effective Delivery work config is derived on demand, not stored separately.
 * Delivery work uses the current resolved config each time work is run.
 * Null config records, null values, and null work dimensions are skipped.
 * Portfolio config always has a non-null value when its record exists.
 *
 * Delivery.config.value.work
 * -> Project.config.value.work
 * -> PortfolioConfigRecord.value.work
 */
export type DeliveryWorkConfigResolution = DeliveryWorkConfig

export type DeliveryTarget = SourceControlDeliveryTarget

export interface SourceControlDeliveryTarget {
	type: 'source-control'
	repositoryId: RepositoryId

	/** Immutable. Delivery Branch is created from this and merged back into it on Ship. */
	targetBranch: string
}

export interface Slice {
	id: SliceId
	deliveryId: DeliveryId
	title: string

	/** Immutable after Plan Output acceptance. */
	instruction: InstructionSource

	accepted: AuditStamp
}

/**
 * Derived in priority order: complete, needs-delivery-validation,
 * dependency-blocked, executing, needs-artifact-validation, correction-blocked,
 * awaiting-review, slice-operation-failed, needs-artifact-creation, then
 * executable.
 */
export interface FailureChain {
	/** The failed validation or external-operation Action that started the chain. */
	rootActionId: ActionId

	/** Number of correction execution Actions started for this chain. */
	correctionRetries: number
}

export type SliceWorkState =
	/** actionId points to the passed validate-delivery-artifact Action that completed the Slice. */
	| { type: 'complete'; actionId: ActionId }
	/** Slice Artifact was promoted into the Delivery Artifact and the resulting Delivery Artifact still needs validation. */
	| { type: 'needs-delivery-validation'; actionId: ActionId }
	/** blockedBy contains direct incomplete same-Delivery Slice dependencies only, ordered by dependency accepted time then SliceId. */
	| { type: 'dependency-blocked'; blockedBy: SliceId[] }
	| { type: 'executing'; mode: 'initial'; agentRunId: AgentRunId }
	| { type: 'executing'; mode: 'correction'; agentRunId: AgentRunId; failureChain: FailureChain }
	| { type: 'needs-artifact-validation'; mode: 'initial'; sliceArtifactId: SliceArtifactId }
	| {
			type: 'needs-artifact-validation'
			mode: 'correction'
			sliceArtifactId: SliceArtifactId
			failureChain: FailureChain
	  }
	/** actionId points to the latest failed Action that exhausted retries; failureChain.rootActionId points to the first failed Action in the chain. */
	| { type: 'correction-blocked'; actionId: ActionId; failureChain: FailureChain }
	| { type: 'awaiting-review'; reviewSurfaceId: ReviewSurfaceId }
	/** Latest Slice-scoped external operation failed before correction could run; explicit manual retry/recovery operation will be added later. */
	| { type: 'slice-operation-failed'; actionId: ActionId }
	/** Slice is otherwise initially executable, but its Slice Artifact has not been created yet. */
	| { type: 'needs-artifact-creation' }
	| { type: 'executable'; mode: 'initial' }
	| { type: 'executable'; mode: 'correction'; failureChain: FailureChain }

// -----------------------------------------------------------------------------
// Links / Graph
// -----------------------------------------------------------------------------

export type GraphNodeRef =
	| { type: 'plan'; id: PlanId }
	| { type: 'project'; id: ProjectId }
	| { type: 'delivery'; id: DeliveryId }
	| { type: 'slice'; id: SliceId }
	| { type: 'memory'; id: MemoryId }

export type LinkType = 'produced' | 'implements' | 'references' | 'supersedes' | 'supports' | 'contradicts' | 'depends-on'

export interface Link {
	id: LinkId
	type: LinkType
	from: GraphNodeRef
	to: GraphNodeRef
	created: AuditStamp

	/** Only archivable Link types may set this. */
	archived: AuditStamp | null
}

// -----------------------------------------------------------------------------
// Artifacts
// -----------------------------------------------------------------------------

/**
 * Each Delivery has at most one Delivery Artifact. Future Project Source Types
 * that need multiple concrete artifacts can model them inside their artifact config.
 */
export interface DeliveryArtifact {
	id: DeliveryArtifactId
	deliveryId: DeliveryId
	config: DeliveryArtifactConfig
	created: AuditStamp
}

export type DeliveryArtifactConfig = SourceControlDeliveryArtifactConfig
export type DeliveryArtifactType = DeliveryArtifactConfig['type']

export interface SourceControlDeliveryArtifactConfig {
	type: 'source-control'
	deliveryBranch: string
}

/**
 * Each Slice has at most one Slice Artifact. Future Project Source Types that
 * need multiple concrete artifacts can model them inside their artifact config.
 */
export interface SliceArtifact {
	id: SliceArtifactId
	sliceId: SliceId
	config: SliceArtifactConfig
	created: AuditStamp
}

export type SliceArtifactConfig = SourceControlSliceArtifactConfig
export type SliceArtifactType = SliceArtifactConfig['type']

export interface SourceControlSliceArtifactConfig {
	type: 'source-control'
	sliceBranch: string
}

// -----------------------------------------------------------------------------
// Action / Agent Run
// -----------------------------------------------------------------------------

export interface Action {
	id: ActionId
	deliveryId: DeliveryId
	performed: RuntimeRecord

	/** Non-null only when the Action is the authoritative fact created by an explicit consumer-authorized operation; scheduler/runtime Actions use null. */
	authorized: AuditStamp | null

	result: ActionResult
}

/**
 * Action results are concrete performed facts.
 * Variant names use domain verbs for explicit Delivery lifecycle transitions,
 * otherwise create/start/observe/validate/promote/record verbs.
 */
export type ActionResult =
	| { type: 'queue-delivery' }
	| { type: 'ship-delivery'; integration: DeliveryIntegration }
	| { type: 'abandon-delivery'; reason: string; cleanupEvidence: ExternalOperationEvidence[] }
	| { type: 'validate-preflight'; evidence: ValidationEvidence }
	| { type: 'create-delivery-artifact'; deliveryArtifactId: DeliveryArtifactId }
	| { type: 'create-slice-artifact'; sliceId: SliceId; sliceArtifactId: SliceArtifactId }
	| { type: 'start-slice-execution'; sliceId: SliceId; mode: 'initial' | 'correction'; agentRunId: AgentRunId }
	| { type: 'start-revision-planning'; revisionGateId: RevisionGateId; agentRunId: AgentRunId }
	| { type: 'validate-slice-artifact'; sliceId: SliceId; evidence: ValidationEvidence }
	| { type: 'create-slice-review-surface'; sliceId: SliceId; reviewSurfaceId: ReviewSurfaceId }
	| { type: 'observe-slice-review-surface'; sliceId: SliceId; reviewSurfaceId: ReviewSurfaceId }
	| { type: 'promote-slice-artifact'; sliceId: SliceId; evidence: ExternalOperationEvidence }
	| { type: 'validate-delivery-artifact'; evidence: ValidationEvidence }
	/** Positive observation that the Delivery Artifact is already integrated into the target. */
	| { type: 'observe-delivery-artifact-integration'; evidence: ExternalOperationEvidence }
	| { type: 'create-delivery-review-surface'; reviewSurfaceId: ReviewSurfaceId }
	| { type: 'observe-delivery-review-surface'; reviewSurfaceId: ReviewSurfaceId }
	| { type: 'start-revision-execution'; revisionId: RevisionId; agentRunId: AgentRunId }
	| { type: 'record-slice-external-operation-failure'; sliceId: SliceId; evidence: ExternalOperationEvidence }
	| { type: 'record-revision-external-operation-failure'; revisionId: RevisionId; evidence: ExternalOperationEvidence }
	| { type: 'record-delivery-external-operation-failure'; evidence: ExternalOperationEvidence }

export interface AgentRun {
	id: AgentRunId
	agent: Agent
	purpose: AgentRunPurpose
	started: RuntimeRecord
	completed: RuntimeRecord | null
}

export type Agent = ModelAgent

export interface ModelAgent {
	type: 'model'
	modelId: ModelId
}

export type AgentRunPurpose =
	| { type: 'planning'; planId: PlanId }
	| { type: 'revision-planning'; revisionGateId: RevisionGateId }
	| { type: 'execution'; actionId: ActionId }
	| { type: 'revision-execution'; revisionId: RevisionId; actionId: ActionId }

// -----------------------------------------------------------------------------
// Evidence / validation / external operation failures
// -----------------------------------------------------------------------------

export type CorrectionEvidence = ValidationEvidence | ExternalOperationEvidence

/**
 * preflightModel returns model-preflight evidence.
 * runDeliveryWork records failed delivery-preflight evidence as validate-preflight Actions.
 * Successful delivery-preflight evidence is recorded only when it supersedes the latest failed validate-preflight Action.
 */
export interface ValidationEvidence {
	type: 'validation'
	operation: ValidationOperation
	passed: boolean
	summary: string
}

export type ValidationOperation =
	| { type: 'delivery-preflight' }
	| { type: 'model-preflight' }
	| { type: 'slice-branch-validation' }
	| { type: 'delivery-branch-validation' }

export interface ExternalOperationEvidence {
	type: 'external-operation'
	operation: ExternalOperation
	passed: boolean
	summary: string
}

export type ExternalOperation =
	| { type: 'create-artifact' }
	| { type: 'push-branch' }
	| { type: 'create-review-surface' }
	| { type: 'merge-review-surface' }
	| { type: 'observe-artifact-integration' }
	| { type: 'close-review-surface' }
	| { type: 'fetch-feedback' }

// -----------------------------------------------------------------------------
// Review Surface
// -----------------------------------------------------------------------------

export type ReviewSurfaceScope =
	| { type: 'slice'; sliceId: SliceId; sliceArtifactId: SliceArtifactId }
	| { type: 'delivery'; deliveryId: DeliveryId; deliveryArtifactId: DeliveryArtifactId }

export interface ReviewSurface {
	id: ReviewSurfaceId
	scope: ReviewSurfaceScope
	config: ReviewSurfaceConfig

	/** Required creation metadata only. No labels/assignees/reviewers/comments in v1. */
	title: string
	body: string

	/** Merged, closed-without-merge, and replaced are mutually exclusive closed outcomes. */
	closed: ReviewSurfaceClosed | null

	created: AuditStamp
}

export type ReviewSurfaceConfig = GitHubPullRequestReviewSurfaceConfig
export type ReviewSurfaceProvider = ReviewSurfaceConfig['provider']

export interface GitHubPullRequestReviewSurfaceConfig {
	provider: 'github'

	/** GitHub pull request identity within the repository. */
	pullRequestNumber: number

	/** Source Control facts. */
	repositoryId: RepositoryId
	sourceBranch: string
	targetBranch: string
}

export type ReviewSurfaceClosed = ReviewSurfaceMerged | ReviewSurfaceClosedWithoutMerge | ReviewSurfaceReplaced

export interface ReviewSurfaceMerged {
	type: 'merged'
	merged: AuditStamp
	config: ReviewSurfaceMergedConfig
}

export type ReviewSurfaceMergedConfig = SourceControlReviewSurfaceMergedConfig

export interface SourceControlReviewSurfaceMergedConfig {
	type: 'source-control'
	repositoryId: RepositoryId
	sourceBranch: string
	targetBranch: string
}

export interface ReviewSurfaceClosedWithoutMerge {
	type: 'closed-without-merge'
	closed: AuditStamp
}

export interface ReviewSurfaceReplaced {
	type: 'replaced'
	replaced: AuditStamp
	reviewSurfaceId: ReviewSurfaceId
}

// -----------------------------------------------------------------------------
// Feedback / Revision Gate / Revision Output proposal shape / Revision
// -----------------------------------------------------------------------------

/**
 * Feedback is fetched from the current Review Surface.
 * It is not stored as authoritative Portfolio data in v1.
 */
export interface FetchedFeedback {
	reviewSurfaceId: ReviewSurfaceId
	config: FetchedFeedbackConfig
	body: string
	createdAt: IsoDateTime | null
	updatedAt: IsoDateTime | null
}

export type FetchedFeedbackConfig = GitHubFetchedFeedbackConfig
export type FetchedFeedbackProvider = FetchedFeedbackConfig['provider']

export interface GitHubFetchedFeedbackConfig {
	provider: 'github'
	externalFeedbackId: string
	author: string | null
	url: string | null
}

export type RevisionScope =
	| { type: 'slice-artifact'; sliceId: SliceId; sliceArtifactId: SliceArtifactId }
	| { type: 'delivery-artifact'; deliveryId: DeliveryId; deliveryArtifactId: DeliveryArtifactId }

export interface RevisionGate {
	id: RevisionGateId
	scope: RevisionScope
	reviewSurfaceId: ReviewSurfaceId
	opened: AuditStamp
	closed: AuditStamp | null

	/** Set when a Revision Output is accepted and Revision is created. */
	consumedByRevisionId: RevisionId | null
}

/**
 * RevisionOutputProposal is not a stored Portfolio artifact.
 * It is the structured shape a revision-planning Agent Run must produce.
 */
export interface RevisionOutputProposal {
	instruction: InstructionSource

	/** Human-readable account of how fetched Feedback is handled. */
	disposition: RevisionDisposition
}

export interface Revision {
	id: RevisionId
	revisionGateId: RevisionGateId
	scope: RevisionScope
	instruction: InstructionSource
	disposition: RevisionDisposition
	accepted: AuditStamp
}

export interface RevisionDisposition {
	/** Immutable human-readable account of how the Revision responds to fetched Feedback. */
	body: string
}

// -----------------------------------------------------------------------------
// Memory
// -----------------------------------------------------------------------------

export type MemoryType = 'decision' | 'fact' | 'constraint' | 'assumption' | 'risk' | 'architecture' | 'workflow' | 'convention'

export interface Memory {
	id: MemoryId
	title: string
	body: string
	type: MemoryType | null
	created: AuditStamp
}

// -----------------------------------------------------------------------------
// Secrets
// -----------------------------------------------------------------------------

export type SecretType = 'github-pat' | 'generic'

export interface Secret {
	id: SecretId
	type: SecretType
	name: string

	/** Consumer-specific protected value reference. Core never exposes/logs plaintext. */
	valueRef: string

	created: AuditStamp
	replaced: AuditStamp | null
}

export type SecretBindingScope =
	| { type: 'portfolio' }
	| { type: 'project'; projectId: ProjectId }
	| { type: 'delivery'; deliveryId: DeliveryId }

export interface SecretBinding {
	id: SecretBindingId
	secretId: SecretId
	scope: SecretBindingScope

	/** Must match /^[A-Z_][A-Z0-9_]*$/. */
	envName: string

	created: AuditStamp
	archived: AuditStamp | null
}

/**
 * Secret Binding environment resolution is derived, not stored separately.
 * Active bindings with the same envName are unique per exact
 * scope. Inner scopes override outer scopes by environment variable name.
 *
 * planning:
 *   Portfolio -> Project
 *
 * revision-planning:
 *   Portfolio -> Project -> Delivery
 *
 * execution:
 *   Portfolio -> Project -> Delivery
 *
 * revision-execution:
 *   Portfolio -> Project -> Delivery
 */
export type ResolvedSecretEnvironment = Array<{
	envName: string
	secretId: SecretId
}>

// -----------------------------------------------------------------------------
// Portfolio Snapshot
// -----------------------------------------------------------------------------

export interface PortfolioSnapshotManifest {
	id: SnapshotId
	snapshotVersion: string
	exported: AuditStamp

	/** Passphrase-encrypted payload containing Portfolio storage contents. */
	encryptedPayloadRef: string
}
