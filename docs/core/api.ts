/*
 * Gorchestra core API sketch.
 *
 * This file is documentation-by-type, not an implementation contract yet.
 * It describes how consumers call Portfolio-scoped core operations and how core
 * calls consumer-provided storage and ports for source control, model agents,
 * secrets, and snapshot encryption.
 *
 * Consumers authorize operations before calling core. Core enforces core
 * invariants and owns orchestration behavior inside the opened Portfolio space.
 */

import type { PipeError } from "valleyed";

import type {
  Action,
  CorrectionEvidence,
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
  InstructionSource,
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
  ReviewSurfaceConfig,
  ReviewSurfaceId,
  ReviewSurfaceMerged,
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
  SecretType,
  Slice,
  SliceArtifact,
  SliceArtifactId,
  SliceId,
  SourceControlDeliveryArtifactConfig,
  SourceControlSliceArtifactConfig,
  ValidationEvidence,
  ValidationOperation,
} from "./model";

// -----------------------------------------------------------------------------
// Entrypoint
// -----------------------------------------------------------------------------

export interface GorchestraCore {
  commands: CoreCommands;
  queries: CoreQueries;
}

export interface OpenCoreOptions {
  storage: CoreStorage;
  ports: CorePorts;
  clock: Clock;
  idGenerator: IdGenerator;
}

export declare function openCore(options: OpenCoreOptions): Result<GorchestraCore, OpenCoreError>;

export interface Clock {
  now(): IsoDateTime;
}

export interface IdGenerator {
  nextId<Name extends string>(brand: Name): string;
}

export interface OperationContext {
  actor: LocalActorRef;
  correlationId: string | null;
}

// -----------------------------------------------------------------------------
// Result / errors
// -----------------------------------------------------------------------------

export type Result<T, E = CoreError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type CoreInputBoundary = "construction" | "snapshot-import" | "command" | "query";

export interface InvalidInputError {
  type: "invalid-input";
  boundary: CoreInputBoundary;
  operation: string;
  pipeError: PipeError;
}

export interface NotImplementedError {
  type: "not-implemented";
  operation: string;
}

export type OpenCoreError = InvalidInputError;

export type DeliveryWorkStateType = DeliveryWorkState["type"];

/**
 * invariant-violation is reserved for impossible/corrupt states.
 * Expected domain failures should use specific CoreError variants.
 */
export type CoreError =
  | InvalidInputError
  | NotImplementedError
  | { type: "not-found"; resource: string; id: string }
  | { type: "invariant-violation"; message: string }
  | { type: "model-preflight-failed"; modelId: ModelId; evidence: ValidationEvidence }
  | { type: "delivery-work-state-mismatch"; deliveryId: DeliveryId; expected: DeliveryWorkStateType[]; actual: DeliveryWorkState }
  | { type: "revision-gate-closed"; revisionGateId: RevisionGateId }
  | { type: "agent-run-model-unresolved"; purpose: AgentRunPurpose }
  | { type: "archived-model"; modelId: ModelId }
  | { type: "archived-model-provider"; modelProviderId: ModelProviderId }
  | { type: "external-operation-failed"; evidence: ExternalOperationEvidence };

// -----------------------------------------------------------------------------
// Consumer -> core commands
// -----------------------------------------------------------------------------

export interface CoreCommands {
  // Portfolio config
  setPortfolioConfig(input: SetPortfolioConfigInput, context: OperationContext): Promise<Result<PortfolioConfigRecord>>;

  // Model Providers / Models
  createModelProvider(input: CreateModelProviderInput, context: OperationContext): Promise<Result<ModelProvider>>;
  updateModelProvider(input: UpdateModelProviderInput, context: OperationContext): Promise<Result<ModelProvider>>;
  archiveModelProvider(input: ArchiveModelProviderInput, context: OperationContext): Promise<Result<ModelProvider>>;
  unarchiveModelProvider(input: UnarchiveModelProviderInput, context: OperationContext): Promise<Result<ModelProvider>>;
  createModel(input: CreateModelInput, context: OperationContext): Promise<Result<Model>>;
  updateModel(input: UpdateModelInput, context: OperationContext): Promise<Result<Model>>;
  archiveModel(input: ArchiveModelInput, context: OperationContext): Promise<Result<Model>>;
  unarchiveModel(input: UnarchiveModelInput, context: OperationContext): Promise<Result<Model>>;
  preflightModel(input: PreflightModelInput, context: OperationContext): Promise<Result<ValidationEvidence>>;

  // Planning
  createPlan(input: CreatePlanInput, context: OperationContext): Promise<Result<Plan>>;
  acceptPlanOutput(input: AcceptPlanOutputInput, context: OperationContext): Promise<Result<AcceptPlanOutputResult>>;
  rejectPlanOutput(input: RejectPlanOutputInput, context: OperationContext): Promise<Result<void>>;

  // Delivery execution
  /**
   * V1 Action authorization policy:
   * - runDeliveryWork records scheduler/runtime Actions with authorized null.
   * - queueDelivery, retryDeliveryPreflight, shipDelivery, and abandonDelivery record consumer-authorized Actions.
   * - other consumer-authorized lifecycle/config operations record domain-named AuditStamp fields instead of Actions.
   */
  /** Requires Delivery Work State not closed. Does not clear preflight-failed. */
  configureDelivery(input: ConfigureDeliveryInput, context: OperationContext): Promise<Result<Delivery>>;

  /** Requires Delivery Work State unqueued; records exactly one queue-delivery Action; duplicate calls fail with delivery-work-state-mismatch. */
  queueDelivery(input: QueueDeliveryInput, context: OperationContext): Promise<Result<QueueDeliveryResult>>;

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
  runDeliveryWork(input: RunDeliveryWorkInput, context: OperationContext): Promise<Result<RunDeliveryWorkResult>>;

  /**
   * Explicitly retries Delivery preflight for a Delivery whose Delivery Work
   * State is preflight-failed. Records a validate-preflight Action whose
   * authorized field is set from the OperationContext because that Action is the
   * authoritative retry fact; a passed retry supersedes the previous failure by
   * ordering. Returns delivery-work-state-mismatch if the Delivery Work State is not
   * preflight-failed.
   */
  retryDeliveryPreflight(input: RetryDeliveryPreflightInput, context: OperationContext): Promise<Result<RetryDeliveryPreflightResult>>;

  // Revision
  openRevisionGate(input: OpenRevisionGateInput, context: OperationContext): Promise<Result<OpenRevisionGateResult>>;
  acceptRevisionOutput(input: AcceptRevisionOutputInput, context: OperationContext): Promise<Result<AcceptRevisionOutputResult>>;
  closeRevisionGate(input: CloseRevisionGateInput, context: OperationContext): Promise<Result<void>>;

  // Delivery close operations
  /** Requires Delivery Work State ready-to-ship; records exactly one ship-delivery Action without post-merge validation in v1; duplicate calls fail with delivery-work-state-mismatch. */
  shipDelivery(input: ShipDeliveryInput, context: OperationContext): Promise<Result<ShipDeliveryResult>>;
  /** Requires Delivery Work State not closed; records exactly one abandon-delivery Action after required cleanup evidence is embedded; duplicate calls fail with delivery-work-state-mismatch. */
  abandonDelivery(input: AbandonDeliveryInput, context: OperationContext): Promise<Result<AbandonDeliveryResult>>;

  // Project / Repository config
  createProject(input: CreateProjectInput, context: OperationContext): Promise<Result<Project>>;
  setProjectConfig(input: SetProjectConfigInput, context: OperationContext): Promise<Result<Project>>;
  createRepository(input: CreateRepositoryInput, context: OperationContext): Promise<Result<Repository>>;
  updateRepositoryConfig(input: UpdateRepositoryConfigInput, context: OperationContext): Promise<Result<Repository>>;

  // Secrets
  createSecret(input: CreateSecretInput, context: OperationContext): Promise<Result<Secret>>;
  replaceSecret(input: ReplaceSecretInput, context: OperationContext): Promise<Result<Secret>>;
  bindSecret(input: BindSecretInput, context: OperationContext): Promise<Result<SecretBinding>>;
  archiveSecretBinding(input: ArchiveSecretBindingInput, context: OperationContext): Promise<Result<void>>;

  // Snapshot
  exportSnapshot(input: ExportSnapshotInput, context: OperationContext): Promise<Result<PortfolioSnapshotManifest>>;
}

export interface SetPortfolioConfigInput {
  /** Creates or updates the retained Portfolio config record; model.defaultModelId is required. */
  config: PortfolioConfig;
}

export interface CreateModelProviderInput {
  name: string;
  protocol: ModelProviderProtocol;
  baseUrl: string;
  auth: ModelProviderAuth | null;
  headers: ModelProviderHeader[];
}

export interface UpdateModelProviderInput {
  modelProviderId: ModelProviderId;
  name: string;
  baseUrl: string;
  auth: ModelProviderAuth | null;
  headers: ModelProviderHeader[];
}

export interface ArchiveModelProviderInput {
  modelProviderId: ModelProviderId;
}

export interface UnarchiveModelProviderInput {
  modelProviderId: ModelProviderId;
}

export interface CreateModelInput {
  providerId: ModelProviderId;
  name: string;
  providerModelId: string;
}

export interface UpdateModelInput {
  modelId: ModelId;
  name: string;
}

export interface ArchiveModelInput {
  modelId: ModelId;
}

export interface UnarchiveModelInput {
  modelId: ModelId;
}

export interface PreflightModelInput {
  modelId: ModelId;
}

export interface CreatePlanInput {
  projectId: ProjectId;
  title: string;

  /** Null or all-null dimensions start with no Plan config record. */
  config: PlanConfig | null;
}

export interface AcceptPlanOutputInput {
  planId: PlanId;

  /** Proposal shape produced by a planning Agent Run; not stored as a Portfolio artifact. */
  output: PlanOutputProposal;
}

export interface AcceptPlanOutputResult {
  deliveries: Delivery[];
  slices: Slice[];
  memories: Memory[];
  links: Link[];
}

export interface RejectPlanOutputInput {
  planId: PlanId;
}

export interface ConfigureDeliveryInput {
  deliveryId: DeliveryId;

  /** Creates or updates the retained Delivery config record; all-null dimensions store value as null. */
  config: DeliveryConfig;
}

export interface QueueDeliveryInput {
  deliveryId: DeliveryId;
}

export interface QueueDeliveryResult {
  delivery: Delivery;
  action: Action;
}

export interface RunDeliveryWorkInput {
  deliveryId: DeliveryId;
}

export type RunDeliveryWorkResult =
  /** At least one of actionIds or agentRunIds must be non-empty. */
  | { type: "worked"; actionIds: ActionId[]; agentRunIds: AgentRunId[] }
  | { type: "no-op"; reason: RunDeliveryWorkNoOpReason };

export type RunDeliveryWorkNoOpReason =
  | { type: "no-eligible-work" }
  | { type: "slice-capacity-full"; activeSlots: number; maxActiveSliceSlots: number }
  | { type: "claim-conflict"; work: RunDeliveryWorkClaimConflictWork }
  | { type: "no-observed-change"; observed: RunDeliveryWorkNoObservedChangeTarget };

export type RunDeliveryWorkClaimConflictWork =
  | { type: "delivery" }
  | { type: "slice"; sliceId: SliceId };

export type RunDeliveryWorkNoObservedChangeTarget =
  | { type: "slice-review-surface"; sliceId: SliceId; reviewSurfaceId: ReviewSurfaceId }
  | { type: "delivery-review-surface"; reviewSurfaceId: ReviewSurfaceId };

export interface RetryDeliveryPreflightInput {
  deliveryId: DeliveryId;
}

export interface RetryDeliveryPreflightResult {
  delivery: Delivery;
  action: Action;
}

export interface OpenRevisionGateInput {
  reviewSurfaceId: ReviewSurfaceId;
}

export interface OpenRevisionGateResult {
  revisionGate: RevisionGate;

  /** Fetched from current Review Surface; not stored as authoritative Portfolio data. */
  feedback: FetchedFeedback[];
}

export interface AcceptRevisionOutputInput {
  revisionGateId: RevisionGateId;

  /** Proposal shape produced by a revision-planning Agent Run; not stored as a Portfolio artifact. */
  output: RevisionOutputProposal;
}

export interface AcceptRevisionOutputResult {
  revision: Revision;
}

export interface CloseRevisionGateInput {
  revisionGateId: RevisionGateId;
}

export interface ShipDeliveryInput {
  deliveryId: DeliveryId;
}

export interface ShipDeliveryResult {
  delivery: Delivery;
  action: Action;
}

export interface AbandonDeliveryInput {
  deliveryId: DeliveryId;
  reason: string;
}

export interface AbandonDeliveryResult {
  delivery: Delivery;
  action: Action;
}

export interface CreateProjectInput {
  title: string;
  source: ProjectSource;

  /** Null or all-null dimensions start with no Project config record. */
  config: ProjectConfig | null;
}

export interface SetProjectConfigInput {
  projectId: ProjectId;

  /** Creates or updates the retained Project config record; all-null dimensions store value as null. */
  config: ProjectConfig;
}

export interface CreateRepositoryInput {
  projectId: ProjectId;
  config: RepositoryConfig;
}

export interface UpdateRepositoryConfigInput {
  repositoryId: RepositoryId;
  config: RepositoryConfig;
}

export interface CreateSecretInput {
  type: SecretType;
  name: string;

  /** Consumer-specific protected value reference. */
  valueRef: string;
}

export interface ReplaceSecretInput {
  secretId: SecretId;
  valueRef: string;
}

export interface BindSecretInput {
  secretId: SecretId;
  scope: SecretBindingScope;
  envName: string;
}

export interface ArchiveSecretBindingInput {
  secretBindingId: SecretBindingId;
}

export interface ExportSnapshotInput {
  passphrase: string;
}

/**
 * Import creates a new Portfolio storage boundary, so it is not a command on an
 * already-open GorchestraCore instance.
 */
export interface ImportSnapshotInput {
  passphrase: string;
  encryptedPayload: Uint8Array;
  storage: CoreStorage;
  snapshotEncryption: SnapshotEncryptionPort;
}

export interface ImportSnapshotResult {
  manifest: PortfolioSnapshotManifest;
}

export interface SnapshotDecryptionFailureError {
  type: "snapshot-decryption-failed";
  message: string;
}

export interface InvalidSnapshotError {
  type: "invalid-snapshot";
  message: string;
}

export interface StorageOperationFailureError {
  type: "storage-operation-failed";
  message: string;
}

export type ImportSnapshotError =
  | InvalidInputError
  | SnapshotDecryptionFailureError
  | InvalidSnapshotError
  | StorageOperationFailureError
  | NotImplementedError;

export declare function importSnapshot(
  input: ImportSnapshotInput,
  context: OperationContext,
): Promise<Result<ImportSnapshotResult, ImportSnapshotError>>;

// -----------------------------------------------------------------------------
// Consumer -> core queries
// -----------------------------------------------------------------------------

export interface CoreQueries {
  getPortfolioConfig(): Promise<Result<PortfolioConfigRecord | null>>;

  getProject(id: ProjectId): Promise<Result<Project | null>>;
  listProjects(): Promise<Result<Project[]>>;

  getRepository(id: RepositoryId): Promise<Result<Repository | null>>;
  listRepositories(filter: RepositoryFilter | null): Promise<Result<Repository[]>>;

  getModelProvider(id: ModelProviderId): Promise<Result<ModelProvider | null>>;
  listModelProviders(filter: ModelProviderFilter | null): Promise<Result<ModelProvider[]>>;

  getModel(id: ModelId): Promise<Result<Model | null>>;
  listModels(filter: ModelFilter | null): Promise<Result<Model[]>>;

  getPlan(id: PlanId): Promise<Result<Plan | null>>;
  listPlans(filter: PlanFilter | null): Promise<Result<Plan[]>>;

  getDelivery(id: DeliveryId): Promise<Result<Delivery | null>>;
  listDeliveries(filter: DeliveryFilter | null): Promise<Result<Delivery[]>>;

  getSlice(id: SliceId): Promise<Result<Slice | null>>;
  listSlices(deliveryId: DeliveryId): Promise<Result<Slice[]>>;

  getReviewSurface(id: ReviewSurfaceId): Promise<Result<ReviewSurface | null>>;
  listReviewSurfaces(scope: ReviewSurfaceScope): Promise<Result<ReviewSurface[]>>;
  getCurrentReviewSurface(scope: ReviewSurfaceScope): Promise<Result<ReviewSurface | null>>;

  getRevision(id: RevisionId): Promise<Result<Revision | null>>;
  listRevisions(scope: RevisionScope): Promise<Result<Revision[]>>;

  getTimeline(filter: TimelineFilter | null): Promise<Result<TimelineEvent[]>>;
}

export interface RepositoryFilter {
  projectId: ProjectId | null;
}

export interface ModelProviderFilter {
  archived: boolean | null;
}

export interface ModelFilter {
  providerId: ModelProviderId | null;
  selectable: boolean | null;
}

export interface PlanFilter {
  projectId: ProjectId | null;
}

export interface DeliveryFilter {
  projectId: ProjectId | null;
  closed: "open" | "shipped" | "abandoned" | null;
}

export interface TimelineFilter {
  deliveryId: DeliveryId | null;
  sliceId: SliceId | null;
  since: IsoDateTime | null;
  until: IsoDateTime | null;
}

export interface TimelineEvent {
  occurredAt: IsoDateTime;
  eventType: string;
  summary: string;
}

// -----------------------------------------------------------------------------
// Core -> consumer ports
// -----------------------------------------------------------------------------

export interface CorePorts {
  sourceControl: SourceControlPort;
  modelAgentRuntime: ModelAgentRuntimePort;
  secrets: SecretResolutionPort;
  snapshotEncryption: SnapshotEncryptionPort;
  events: CoreEventSink | null;
  logger: CoreLogger | null;
}

// -----------------------------------------------------------------------------
// Storage port
// -----------------------------------------------------------------------------

export interface CoreStorage {
  transaction<T>(fn: (tx: CoreStorageTransaction) => Promise<T>): Promise<T>;
}

export interface CoreStorageTransaction {
  portfolioConfig: SingletonRepository<PortfolioConfigRecord>;
  projects: RepositoryTable<Project, ProjectId>;
  repositories: RepositoryTable<Repository, RepositoryId>;
  modelProviders: RepositoryTable<ModelProvider, ModelProviderId>;
  models: RepositoryTable<Model, ModelId>;
  plans: RepositoryTable<Plan, PlanId>;
  deliveries: RepositoryTable<Delivery, DeliveryId>;
  slices: RepositoryTable<Slice, SliceId>;
  links: RepositoryTable<Link, LinkId>;
  memories: RepositoryTable<Memory, MemoryId>;
  deliveryArtifacts: RepositoryTable<DeliveryArtifact, DeliveryArtifactId>;
  sliceArtifacts: RepositoryTable<SliceArtifact, SliceArtifactId>;
  actions: RepositoryTable<Action, ActionId>;
  agentRuns: RepositoryTable<AgentRun, AgentRunId>;
  reviewSurfaces: RepositoryTable<ReviewSurface, ReviewSurfaceId>;
  revisionGates: RepositoryTable<RevisionGate, RevisionGateId>;
  revisions: RepositoryTable<Revision, RevisionId>;
  secrets: RepositoryTable<Secret, SecretId>;
  secretBindings: RepositoryTable<SecretBinding, SecretBindingId>;
}

export interface SingletonRepository<T> {
  get(): Promise<T | null>;
  put(record: T): Promise<void>;
}

export interface RepositoryTable<T, Id> {
  get(id: Id): Promise<T | null>;
  put(record: T): Promise<void>;
  list(): Promise<T[]>;
}

// -----------------------------------------------------------------------------
// Source Control port
// -----------------------------------------------------------------------------

/**
 * Core uses an internal context resolver to turn authoritative IDs into the
 * current entities, configs, artifacts, branches, repositories, models, and
 * secrets required for commands and port calls. Consumer-facing command inputs
 * prefer IDs over duplicated resolved values so callers cannot provide
 * contradictory context. Runtime/port calls that perform external actions should
 * receive the resolved values needed to perform the action so adapters do not
 * infer, load, or calculate authoritative context themselves.
 */

export interface SourceControlPort {
  preflightRepository(input: PreflightRepositoryInput): Promise<ValidationEvidence>;

  createDeliveryBranch(input: CreateDeliveryBranchInput): Promise<CreateDeliveryBranchResult>;
  createSliceBranch(input: CreateSliceBranchInput): Promise<CreateSliceBranchResult>;

  pushBranch(input: PushBranchInput): Promise<ExternalOperationEvidence>;
  validateBranch(input: ValidateBranchInput): Promise<ValidationEvidence>;

  /** Integrated and failed evidence use operation observe-artifact-integration; not-integrated is transient scheduler branching and is not recorded. */
  observeBranchIntegration(input: ObserveBranchIntegrationInput): Promise<ObserveBranchIntegrationResult>;

  createReviewSurface(input: CreateReviewSurfaceInput): Promise<ReviewSurfaceConfig>;
  fetchReviewSurface(input: FetchReviewSurfaceInput): Promise<ReviewSurface>;
  fetchFeedback(input: FetchFeedbackInput): Promise<FetchedFeedback[]>;
  mergeReviewSurface(input: MergeReviewSurfaceInput): Promise<ReviewSurfaceMerged>;
  closeReviewSurface(input: CloseReviewSurfaceInput): Promise<ExternalOperationEvidence>;
}

export interface PreflightRepositoryInput {
  repository: Repository;
}

export interface CreateDeliveryBranchInput {
  repository: Repository;
  deliveryId: DeliveryId;
  targetBranch: string;
}

export type CreateDeliveryBranchResult =
  | { type: "created"; config: SourceControlDeliveryArtifactConfig }
  /** Failed evidence uses operation create-artifact. */
  | { type: "failed"; evidence: ExternalOperationEvidence };

export interface CreateSliceBranchInput {
  repository: Repository;
  deliveryBranch: string;
  sliceId: SliceId;
}

export type CreateSliceBranchResult =
  | { type: "created"; config: SourceControlSliceArtifactConfig }
  /** Failed evidence uses operation create-artifact. */
  | { type: "failed"; evidence: ExternalOperationEvidence };

export interface PushBranchInput {
  repository: Repository;
  branch: string;
}

export interface ValidateBranchInput {
  repository: Repository;
  branch: string;
  operation: Extract<
    ValidationOperation,
    { type: "slice-branch-validation" | "delivery-branch-validation" }
  >;
}

export interface ObserveBranchIntegrationInput {
  repository: Repository;
  sourceBranch: string;
  targetBranch: string;
}

export type ObserveBranchIntegrationResult =
  | { type: "integrated"; evidence: ExternalOperationEvidence }
  | { type: "not-integrated" }
  | { type: "failed"; evidence: ExternalOperationEvidence };

export interface CreateReviewSurfaceInput {
  repository: Repository;
  scope: ReviewSurfaceScope;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  body: string;
}

export interface FetchReviewSurfaceInput {
  reviewSurface: ReviewSurface;
}

export interface FetchFeedbackInput {
  reviewSurface: ReviewSurface;
}

export interface MergeReviewSurfaceInput {
  reviewSurface: ReviewSurface;
}

export interface CloseReviewSurfaceInput {
  reviewSurface: ReviewSurface;
}

// -----------------------------------------------------------------------------
// Model Agent runtime port
// -----------------------------------------------------------------------------

export interface ModelAgentRuntimePort {
  preflightModel(input: PreflightModelRuntimeInput): Promise<ValidationEvidence>;
  runModelAgent(input: RunModelAgentInput): Promise<void>;
}

export interface PreflightModelRuntimeInput {
  modelProvider: ModelProvider;
  model: Model;
  auth: ResolvedModelProviderAuth;
}

export interface RunModelAgentInput {
  agentRun: AgentRun;
  modelProvider: ModelProvider;
  model: Model;
  auth: ResolvedModelProviderAuth;

  /** Slice execution or Revision execution instructions. */
  instruction: InstructionSource | null;

  /** Validation/external operation failures can be passed to a correction Agent Run. */
  correctionEvidence: CorrectionEvidence[];

  artifactContext: AgentRunArtifactContext | null;
  timeoutMs: number | null;
}

export interface ResolvedModelProviderAuth {
  auth: ResolvedModelProviderStandardAuth | null;
  headers: ResolvedModelProviderHeader[];
}

export type ResolvedModelProviderStandardAuth = ResolvedModelProviderApiKeyAuth;

export interface ResolvedModelProviderApiKeyAuth {
  type: "apiKey";

  /** Plaintext exists only transiently. */
  plaintext: string;
}

export interface ResolvedModelProviderHeader {
  name: string;

  /** Plaintext exists only transiently. */
  value: string;
}

export type AgentRunArtifactContext =
  | { type: "delivery-artifact"; deliveryArtifactId: DeliveryArtifactId }
  | { type: "slice-artifact"; sliceArtifactId: SliceArtifactId };

// -----------------------------------------------------------------------------
// Secret resolution port
// -----------------------------------------------------------------------------

export interface SecretResolutionPort {
  resolveSecrets(input: ResolveSecretsInput): Promise<ResolvedSecret[]>;
  resolveSecretValues(input: ResolveSecretValuesInput): Promise<ResolvedSecretValue[]>;
}

export interface ResolveSecretsInput {
  scope:
    | { type: "project"; projectId: ProjectId }
    | { type: "delivery"; deliveryId: DeliveryId };
}

export interface ResolveSecretValuesInput {
  secretIds: SecretId[];
}

export interface ResolvedSecret {
  secretId: SecretId;
  envName: string;

  /** Plaintext exists only transiently. */
  plaintext: string;
}

export interface ResolvedSecretValue {
  secretId: SecretId;

  /** Plaintext exists only transiently. */
  plaintext: string;
}

// -----------------------------------------------------------------------------
// Snapshot encryption port
// -----------------------------------------------------------------------------

export interface SnapshotEncryptionPort {
  encrypt(input: EncryptSnapshotInput): Promise<EncryptedSnapshot>;
  decrypt(input: DecryptSnapshotInput): Promise<DecryptedSnapshot>;
}

export interface EncryptSnapshotInput {
  passphrase: string;
  plaintextPayload: Uint8Array;
}

export interface DecryptSnapshotInput {
  passphrase: string;
  encryptedPayload: Uint8Array;
}

export interface EncryptedSnapshot {
  bytes: Uint8Array;
}

export interface DecryptedSnapshot {
  bytes: Uint8Array;
}

// -----------------------------------------------------------------------------
// Event sink / logger
// -----------------------------------------------------------------------------

export interface CoreEventSink {
  publish(event: CoreEvent): Promise<void>;
}

export type CoreEvent =
  | { type: "delivery-updated"; deliveryId: DeliveryId }
  | { type: "slice-updated"; sliceId: SliceId }
  | { type: "delivery-work-run"; deliveryId: DeliveryId }
  | { type: "agent-run-started"; agentRunId: AgentRunId }
  | { type: "review-surface-created"; reviewSurfaceId: ReviewSurfaceId }
  | { type: "revision-gate-opened"; revisionGateId: RevisionGateId };

export interface CoreLogger {
  debug(message: string, context: Record<string, unknown> | null): void;
  info(message: string, context: Record<string, unknown> | null): void;
  warn(message: string, context: Record<string, unknown> | null): void;
  error(message: string, context: Record<string, unknown> | null): void;
}
