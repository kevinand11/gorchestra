import type { Pipe } from 'valleyed'

import {
	acceptPlanOutputInputPipe,
	acceptRevisionOutputInputPipe,
	abandonDeliveryInputPipe,
	archiveModelInputPipe,
	archiveModelProviderInputPipe,
	archiveSecretBindingInputPipe,
	bindSecretInputPipe,
	closeRevisionGateInputPipe,
	configureDeliveryInputPipe,
	createModelInputPipe,
	createModelProviderInputPipe,
	createPlanInputPipe,
	createProjectInputPipe,
	createRepositoryInputPipe,
	createSecretInputPipe,
	exportSnapshotInputPipe,
	openRevisionGateInputPipe,
	preflightModelInputPipe,
	preflightRepositoryInputPipe,
	queueDeliveryInputPipe,
	rejectPlanOutputInputPipe,
	replaceSecretInputPipe,
	retryDeliveryPreflightInputPipe,
	runDeliveryWorkInputPipe,
	setPortfolioConfigInputPipe,
	setProjectConfigInputPipe,
	shipDeliveryInputPipe,
	unarchiveModelInputPipe,
	unarchiveModelProviderInputPipe,
	updateModelInputPipe,
	updateModelProviderInputPipe,
	updateRepositoryConfigInputPipe,
	type AcceptPlanOutputInput,
	type AcceptRevisionOutputInput,
	type AbandonDeliveryInput,
	type ArchiveModelInput,
	type ArchiveModelProviderInput,
	type ArchiveSecretBindingInput,
	type BindSecretInput,
	type CloseRevisionGateInput,
	type ConfigureDeliveryInput,
	type CreateModelInput,
	type CreateModelProviderInput,
	type CreatePlanInput,
	type CreateProjectInput,
	type CreateRepositoryInput,
	type CreateSecretInput,
	type ExportSnapshotInput,
	type OpenRevisionGateInput,
	type OperationContext,
	type PreflightModelInput,
	type PreflightRepositoryInput,
	type QueueDeliveryInput,
	type RejectPlanOutputInput,
	type ReplaceSecretInput,
	type RetryDeliveryPreflightInput,
	type RunDeliveryWorkInput,
	type SetPortfolioConfigInput,
	type SetProjectConfigInput,
	type ShipDeliveryInput,
	type UnarchiveModelInput,
	type UnarchiveModelProviderInput,
	type UpdateModelInput,
	type UpdateModelProviderInput,
	type UpdateRepositoryConfigInput,
} from './boundary-pipes'
import type { AlreadyArchivedError, CommandStubError, NotArchivedError } from './errors'
import type {
	Action,
	ActionId,
	AgentRunId,
	Delivery,
	FetchedFeedback,
	Link,
	Memory,
	Model,
	ModelProvider,
	Plan,
	PortfolioConfigRecord,
	PortfolioSnapshotManifest,
	Project,
	Repository,
	ReviewSurfaceId,
	Revision,
	RevisionGate,
	Secret,
	SecretBinding,
	Slice,
	SliceId,
	ValidationEvidence,
} from './model'
import type { Result } from './result'

export interface CoreCommands {
	// Portfolio config
	setPortfolioConfig(
		input: SetPortfolioConfigInput,
		context: OperationContext,
	): Promise<Result<PortfolioConfigRecord, SetPortfolioConfigError>>

	// Model Providers / Models
	createModelProvider(
		input: CreateModelProviderInput,
		context: OperationContext,
	): Promise<Result<ModelProvider, CreateModelProviderError>>
	updateModelProvider(
		input: UpdateModelProviderInput,
		context: OperationContext,
	): Promise<Result<ModelProvider, UpdateModelProviderError>>
	archiveModelProvider(
		input: ArchiveModelProviderInput,
		context: OperationContext,
	): Promise<Result<ModelProvider, ArchiveModelProviderError>>
	unarchiveModelProvider(
		input: UnarchiveModelProviderInput,
		context: OperationContext,
	): Promise<Result<ModelProvider, UnarchiveModelProviderError>>
	createModel(input: CreateModelInput, context: OperationContext): Promise<Result<Model, CreateModelError>>
	updateModel(input: UpdateModelInput, context: OperationContext): Promise<Result<Model, UpdateModelError>>
	archiveModel(input: ArchiveModelInput, context: OperationContext): Promise<Result<Model, ArchiveModelError>>
	unarchiveModel(input: UnarchiveModelInput, context: OperationContext): Promise<Result<Model, UnarchiveModelError>>
	preflightModel(input: PreflightModelInput, context: OperationContext): Promise<Result<ValidationEvidence, PreflightModelError>>
	preflightRepository(
		input: PreflightRepositoryInput,
		context: OperationContext,
	): Promise<Result<ValidationEvidence, PreflightRepositoryError>>

	// Planning
	createPlan(input: CreatePlanInput, context: OperationContext): Promise<Result<Plan, CreatePlanError>>
	acceptPlanOutput(
		input: AcceptPlanOutputInput,
		context: OperationContext,
	): Promise<Result<AcceptPlanOutputResult, AcceptPlanOutputError>>
	rejectPlanOutput(input: RejectPlanOutputInput, context: OperationContext): Promise<Result<void, RejectPlanOutputError>>

	// Delivery execution
	/**
	 * V1 Action authorization policy:
	 * - runDeliveryWork records scheduler/runtime Actions with authorized null.
	 * - queueDelivery, retryDeliveryPreflight, shipDelivery, and abandonDelivery record consumer-authorized Actions.
	 * - other consumer-authorized lifecycle/config operations record domain-named AuditStamp fields instead of Actions.
	 */
	/** Requires Delivery Work State not closed. Does not clear preflight-failed. */
	configureDelivery(input: ConfigureDeliveryInput, context: OperationContext): Promise<Result<Delivery, ConfigureDeliveryError>>

	/** Requires Delivery Work State unqueued; records exactly one queue-delivery Action; duplicate calls fail with delivery-work-state-mismatch. */
	queueDelivery(input: QueueDeliveryInput, context: OperationContext): Promise<Result<QueueDeliveryResult, QueueDeliveryError>>

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
	runDeliveryWork(input: RunDeliveryWorkInput, context: OperationContext): Promise<Result<RunDeliveryWorkResult, RunDeliveryWorkError>>

	/**
	 * Explicitly retries Delivery preflight for a Delivery whose Delivery Work
	 * State is preflight-failed. Records a validate-preflight Action whose
	 * authorized field is set from the OperationContext because that Action is the
	 * authoritative retry fact; a passed retry supersedes the previous failure by
	 * ordering. Returns delivery-work-state-mismatch if the Delivery Work State is not
	 * preflight-failed.
	 */
	retryDeliveryPreflight(
		input: RetryDeliveryPreflightInput,
		context: OperationContext,
	): Promise<Result<RetryDeliveryPreflightResult, RetryDeliveryPreflightError>>

	// Revision
	openRevisionGate(
		input: OpenRevisionGateInput,
		context: OperationContext,
	): Promise<Result<OpenRevisionGateResult, OpenRevisionGateError>>
	acceptRevisionOutput(
		input: AcceptRevisionOutputInput,
		context: OperationContext,
	): Promise<Result<AcceptRevisionOutputResult, AcceptRevisionOutputError>>
	closeRevisionGate(input: CloseRevisionGateInput, context: OperationContext): Promise<Result<void, CloseRevisionGateError>>

	// Delivery close operations
	/** Requires Delivery Work State ready-to-ship; records exactly one ship-delivery Action without post-merge validation in v1; duplicate calls fail with delivery-work-state-mismatch. */
	shipDelivery(input: ShipDeliveryInput, context: OperationContext): Promise<Result<ShipDeliveryResult, ShipDeliveryError>>
	/** Requires Delivery Work State not closed; records exactly one abandon-delivery Action after required cleanup evidence is embedded; duplicate calls fail with delivery-work-state-mismatch. */
	abandonDelivery(input: AbandonDeliveryInput, context: OperationContext): Promise<Result<AbandonDeliveryResult, AbandonDeliveryError>>

	// Project / Repository config
	createProject(input: CreateProjectInput, context: OperationContext): Promise<Result<Project, CreateProjectError>>
	setProjectConfig(input: SetProjectConfigInput, context: OperationContext): Promise<Result<Project, SetProjectConfigError>>
	/** Validates the Project and referenced Secret exist in Portfolio storage, then writes Repository config without calling GitHub. */
	createRepository(input: CreateRepositoryInput, context: OperationContext): Promise<Result<Repository, CreateRepositoryError>>
	/** Validates the Repository and referenced Secret exist in Portfolio storage, then writes Repository config without calling GitHub. */
	updateRepositoryConfig(
		input: UpdateRepositoryConfigInput,
		context: OperationContext,
	): Promise<Result<Repository, UpdateRepositoryConfigError>>

	// Secrets
	createSecret(input: CreateSecretInput, context: OperationContext): Promise<Result<Secret, CreateSecretError>>
	replaceSecret(input: ReplaceSecretInput, context: OperationContext): Promise<Result<Secret, ReplaceSecretError>>
	bindSecret(input: BindSecretInput, context: OperationContext): Promise<Result<SecretBinding, BindSecretError>>
	archiveSecretBinding(input: ArchiveSecretBindingInput, context: OperationContext): Promise<Result<void, ArchiveSecretBindingError>>

	// Snapshot
	exportSnapshot(input: ExportSnapshotInput, context: OperationContext): Promise<Result<PortfolioSnapshotManifest, ExportSnapshotError>>
}

export interface AcceptPlanOutputResult {
	deliveries: Delivery[]
	slices: Slice[]
	memories: Memory[]
	links: Link[]
}

export interface QueueDeliveryResult {
	delivery: Delivery
	action: Action
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

export interface RetryDeliveryPreflightResult {
	delivery: Delivery
	action: Action
}

export interface OpenRevisionGateResult {
	revisionGate: RevisionGate

	/** Fetched from current Review Surface; not stored as authoritative Portfolio data. */
	feedback: FetchedFeedback[]
}

export interface AcceptRevisionOutputResult {
	revision: Revision
}

export interface ShipDeliveryResult {
	delivery: Delivery
	action: Action
}

export interface AbandonDeliveryResult {
	delivery: Delivery
	action: Action
}

export type SetPortfolioConfigError = CommandStubError
export type CreateModelProviderError = CommandStubError
export type UpdateModelProviderError = CommandStubError
export type ArchiveModelProviderError = CommandStubError | AlreadyArchivedError
export type UnarchiveModelProviderError = CommandStubError | NotArchivedError
export type CreateModelError = CommandStubError
export type UpdateModelError = CommandStubError
export type ArchiveModelError = CommandStubError | AlreadyArchivedError
export type UnarchiveModelError = CommandStubError | NotArchivedError
export type PreflightModelError = CommandStubError
export type PreflightRepositoryError = CommandStubError
export type CreatePlanError = CommandStubError
export type AcceptPlanOutputError = CommandStubError
export type RejectPlanOutputError = CommandStubError
export type ConfigureDeliveryError = CommandStubError
export type QueueDeliveryError = CommandStubError
export type RunDeliveryWorkError = CommandStubError
export type RetryDeliveryPreflightError = CommandStubError
export type OpenRevisionGateError = CommandStubError
export type AcceptRevisionOutputError = CommandStubError
export type CloseRevisionGateError = CommandStubError
export type ShipDeliveryError = CommandStubError
export type AbandonDeliveryError = CommandStubError
export type CreateProjectError = CommandStubError
export type SetProjectConfigError = CommandStubError
export type CreateRepositoryError = CommandStubError
export type UpdateRepositoryConfigError = CommandStubError
export type CreateSecretError = CommandStubError
export type ReplaceSecretError = CommandStubError
export type BindSecretError = CommandStubError
export type ArchiveSecretBindingError = CommandStubError | AlreadyArchivedError
export type ExportSnapshotError = CommandStubError

export const commandInputPipes = {
	setPortfolioConfig: setPortfolioConfigInputPipe,
	createModelProvider: createModelProviderInputPipe,
	updateModelProvider: updateModelProviderInputPipe,
	archiveModelProvider: archiveModelProviderInputPipe,
	unarchiveModelProvider: unarchiveModelProviderInputPipe,
	createModel: createModelInputPipe,
	updateModel: updateModelInputPipe,
	archiveModel: archiveModelInputPipe,
	unarchiveModel: unarchiveModelInputPipe,
	preflightModel: preflightModelInputPipe,
	preflightRepository: preflightRepositoryInputPipe,
	createPlan: createPlanInputPipe,
	acceptPlanOutput: acceptPlanOutputInputPipe,
	rejectPlanOutput: rejectPlanOutputInputPipe,
	configureDelivery: configureDeliveryInputPipe,
	queueDelivery: queueDeliveryInputPipe,
	runDeliveryWork: runDeliveryWorkInputPipe,
	retryDeliveryPreflight: retryDeliveryPreflightInputPipe,
	openRevisionGate: openRevisionGateInputPipe,
	acceptRevisionOutput: acceptRevisionOutputInputPipe,
	closeRevisionGate: closeRevisionGateInputPipe,
	shipDelivery: shipDeliveryInputPipe,
	abandonDelivery: abandonDeliveryInputPipe,
	createProject: createProjectInputPipe,
	setProjectConfig: setProjectConfigInputPipe,
	createRepository: createRepositoryInputPipe,
	updateRepositoryConfig: updateRepositoryConfigInputPipe,
	createSecret: createSecretInputPipe,
	replaceSecret: replaceSecretInputPipe,
	bindSecret: bindSecretInputPipe,
	archiveSecretBinding: archiveSecretBindingInputPipe,
	exportSnapshot: exportSnapshotInputPipe,
} satisfies Record<keyof CoreCommands, Pipe<unknown, unknown>>
