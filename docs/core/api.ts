/*
 * Gorchestra core API sketch.
 *
 * This file is documentation-by-type, not an implementation contract yet.
 * It describes how consumers call Portfolio-scoped core operations and how core
 * calls consumer-provided ports for storage, source control, model agents,
 * secrets, and snapshot encryption.
 *
 * Consumers authorize operations before calling core. Core enforces core
 * invariants and owns orchestration behavior inside the opened Portfolio space.
 */

import type {
  Action,
  ActionEvidence,
  ActionId,
  AgentRun,
  AgentRunEvidence,
  AgentRunId,
  DecisionId,
  Delivery,
  DeliveryArtifact,
  DeliveryArtifactId,
  DeliveryId,
  Execution,
  ExecutionId,
  ExecutionPolicy,
  ExecutionPolicyId,
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
  ModelProviderHeader,
  ModelProviderId,
  ModelProviderProtocol,
  DeliveryAgentRunConfig,
  Plan,
  PlanAgentRunConfig,
  PlanId,
  PlanOutputProposal,
  PortfolioAgentRunConfig,
  PortfolioConfig,
  PortfolioSnapshotManifest,
  Project,
  ProjectAgentRunConfig,
  ProjectConfig,
  ProjectId,
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

export declare function openCore(options: OpenCoreOptions): GorchestraCore;

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

export type CoreError =
  | { type: "not-found"; resource: string; id: string }
  | { type: "invariant-violation"; message: string }
  | { type: "preflight-failed"; deliveryId: DeliveryId | null; modelId: ModelId | null; evidence: ValidationEvidence[] }
  | { type: "terminal-delivery"; deliveryId: DeliveryId }
  | { type: "dependency-blocked"; deliveryId: DeliveryId; blockedBy: DeliveryId[] }
  | { type: "revision-gate-closed"; revisionGateId: RevisionGateId }
  | { type: "archived-model"; modelId: ModelId }
  | { type: "archived-model-provider"; modelProviderId: ModelProviderId }
  | { type: "external-operation-failed"; evidence: ExternalOperationEvidence };

// -----------------------------------------------------------------------------
// Consumer -> core commands
// -----------------------------------------------------------------------------

export interface CoreCommands {
  // Portfolio config
  setPortfolioConfig(input: SetPortfolioConfigInput, context: OperationContext): Promise<Result<PortfolioConfig>>;

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
  setPlanAgentRunConfig(input: SetPlanAgentRunConfigInput, context: OperationContext): Promise<Result<Plan>>;
  acceptPlanOutput(input: AcceptPlanOutputInput, context: OperationContext): Promise<Result<AcceptPlanOutputResult>>;
  rejectPlanOutput(input: RejectPlanOutputInput, context: OperationContext): Promise<Result<void>>;

  // Execution
  setDeliveryAgentRunConfig(input: SetDeliveryAgentRunConfigInput, context: OperationContext): Promise<Result<Delivery>>;
  startExecution(input: StartExecutionInput, context: OperationContext): Promise<Result<StartExecutionResult>>;
  resumeExecution(input: ResumeExecutionInput, context: OperationContext): Promise<Result<ResumeExecutionResult>>;

  // Revision
  openRevisionGate(input: OpenRevisionGateInput, context: OperationContext): Promise<Result<OpenRevisionGateResult>>;
  acceptRevisionOutput(input: AcceptRevisionOutputInput, context: OperationContext): Promise<Result<AcceptRevisionOutputResult>>;
  closeRevisionGate(input: CloseRevisionGateInput, context: OperationContext): Promise<Result<void>>;

  // Terminal Delivery operations
  shipDelivery(input: ShipDeliveryInput, context: OperationContext): Promise<Result<ShipDeliveryResult>>;
  abandonDelivery(input: AbandonDeliveryInput, context: OperationContext): Promise<Result<AbandonDeliveryResult>>;

  // Project / Repository config
  createProject(input: CreateProjectInput, context: OperationContext): Promise<Result<Project>>;
  updateProjectConfig(input: UpdateProjectConfigInput, context: OperationContext): Promise<Result<Project>>;
  setProjectAgentRunConfig(input: SetProjectAgentRunConfigInput, context: OperationContext): Promise<Result<Project>>;
  createRepository(input: CreateRepositoryInput, context: OperationContext): Promise<Result<Repository>>;
  updateRepositoryConfig(input: UpdateRepositoryConfigInput, context: OperationContext): Promise<Result<Repository>>;

  // Execution Policy
  setExecutionPolicy(input: SetExecutionPolicyInput, context: OperationContext): Promise<Result<ExecutionPolicy>>;

  // Secrets
  createSecret(input: CreateSecretInput, context: OperationContext): Promise<Result<Secret>>;
  replaceSecret(input: ReplaceSecretInput, context: OperationContext): Promise<Result<Secret>>;
  bindSecret(input: BindSecretInput, context: OperationContext): Promise<Result<SecretBinding>>;
  archiveSecretBinding(input: ArchiveSecretBindingInput, context: OperationContext): Promise<Result<void>>;

  // Snapshot
  exportSnapshot(input: ExportSnapshotInput, context: OperationContext): Promise<Result<PortfolioSnapshotManifest>>;
}

export interface SetPortfolioConfigInput {
  agentRun: SetPortfolioAgentRunConfigInput;
}

export interface SetPortfolioAgentRunConfigInput {
  config: PortfolioAgentRunConfig | null;
}

export interface CreateModelProviderInput {
  name: string;
  protocol: ModelProviderProtocol;
  baseUrl: string;
  apiKeySecretId: SecretId | null;
  headers: ModelProviderHeader[];
}

export interface UpdateModelProviderInput {
  modelProviderId: ModelProviderId;
  name: string;
  baseUrl: string;
  apiKeySecretId: SecretId | null;
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
  agentRun: PlanAgentRunConfig | null;
}

export interface SetPlanAgentRunConfigInput {
  planId: PlanId;
  agentRun: SetPlanAgentRunConfigValue;
}

export interface SetPlanAgentRunConfigValue {
  config: PlanAgentRunConfig | null;
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
  reason: string | null;
}

export interface SetDeliveryAgentRunConfigInput {
  deliveryId: DeliveryId;
  agentRun: SetDeliveryAgentRunConfigValue;
}

export interface SetDeliveryAgentRunConfigValue {
  config: DeliveryAgentRunConfig | null;
}

export interface StartExecutionInput {
  deliveryId: DeliveryId;
}

export interface StartExecutionResult {
  execution: Execution;
}

export interface ResumeExecutionInput {
  executionId: ExecutionId;
}

export interface ResumeExecutionResult {
  execution: Execution;
}

export interface OpenRevisionGateInput {
  scope: RevisionScope;
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
  reason: string | null;
}

export interface ShipDeliveryInput {
  deliveryId: DeliveryId;
}

export interface ShipDeliveryResult {
  delivery: Delivery;
}

export interface AbandonDeliveryInput {
  deliveryId: DeliveryId;
  reason: string | null;
}

export interface AbandonDeliveryResult {
  delivery: Delivery;
}

export interface CreateProjectInput {
  title: string;
  config: ProjectConfig;
  agentRun: ProjectAgentRunConfig | null;
}

export interface UpdateProjectConfigInput {
  projectId: ProjectId;
  config: ProjectConfig;
}

export interface SetProjectAgentRunConfigInput {
  projectId: ProjectId;
  agentRun: SetProjectAgentRunConfigValue;
}

export interface SetProjectAgentRunConfigValue {
  config: ProjectAgentRunConfig | null;
}

export interface CreateRepositoryInput {
  projectId: ProjectId;
  config: RepositoryConfig;
}

export interface UpdateRepositoryConfigInput {
  repositoryId: RepositoryId;
  config: RepositoryConfig;
}

export interface SetExecutionPolicyInput {
  projectId: ProjectId;
  maxParallelSlicesPerDelivery: number;
  maxCorrectionRetries: number;
  agentRunTimeoutMs: number;
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
  environmentVariableName: string | null;
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
  encryptedPayloadRef: string;
  storage: CoreStorage;
}

export interface ImportSnapshotResult {
  manifest: PortfolioSnapshotManifest;
}

export declare function importSnapshot(
  input: ImportSnapshotInput,
  context: OperationContext,
): Promise<Result<ImportSnapshotResult>>;

// -----------------------------------------------------------------------------
// Consumer -> core queries
// -----------------------------------------------------------------------------

export interface CoreQueries {
  getPortfolioConfig(): Promise<PortfolioConfig | null>;

  getProject(id: ProjectId): Promise<Project | null>;
  listProjects(): Promise<Project[]>;

  getRepository(id: RepositoryId): Promise<Repository | null>;
  listRepositories(filter: RepositoryFilter | null): Promise<Repository[]>;

  getModelProvider(id: ModelProviderId): Promise<ModelProvider | null>;
  listModelProviders(filter: ModelProviderFilter | null): Promise<ModelProvider[]>;

  getModel(id: ModelId): Promise<Model | null>;
  listModels(filter: ModelFilter | null): Promise<Model[]>;

  getPlan(id: PlanId): Promise<Plan | null>;
  listPlans(filter: PlanFilter | null): Promise<Plan[]>;

  getDelivery(id: DeliveryId): Promise<Delivery | null>;
  listDeliveries(filter: DeliveryFilter | null): Promise<Delivery[]>;

  getSlice(id: SliceId): Promise<Slice | null>;
  listSlices(deliveryId: DeliveryId): Promise<Slice[]>;

  getReviewSurface(id: ReviewSurfaceId): Promise<ReviewSurface | null>;
  listReviewSurfaces(scope: ReviewSurfaceScope): Promise<ReviewSurface[]>;
  getCurrentReviewSurface(scope: ReviewSurfaceScope): Promise<ReviewSurface | null>;

  getRevision(id: RevisionId): Promise<Revision | null>;
  listRevisions(scope: RevisionScope): Promise<Revision[]>;

  getTimeline(filter: TimelineFilter | null): Promise<TimelineEvent[]>;
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
  terminal: "active" | "shipped" | "abandoned" | null;
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
  storage: CoreStorage;
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
  portfolioConfig: SingletonRepository<PortfolioConfig>;
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
  executions: RepositoryTable<Execution, ExecutionId>;
  actions: RepositoryTable<Action, ActionId>;
  agentRuns: RepositoryTable<AgentRun, AgentRunId>;
  reviewSurfaces: RepositoryTable<ReviewSurface, ReviewSurfaceId>;
  revisionGates: RepositoryTable<RevisionGate, RevisionGateId>;
  revisions: RepositoryTable<Revision, RevisionId>;
  secrets: RepositoryTable<Secret, SecretId>;
  secretBindings: RepositoryTable<SecretBinding, SecretBindingId>;
  executionPolicies: RepositoryTable<ExecutionPolicy, ExecutionPolicyId>;
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

export interface SourceControlPort {
  preflightRepository(input: PreflightRepositoryInput): Promise<ValidationEvidence>;

  createDeliveryBranch(input: CreateDeliveryBranchInput): Promise<SourceControlDeliveryArtifactConfig>;
  createSliceBranch(input: CreateSliceBranchInput): Promise<SourceControlSliceArtifactConfig>;

  pushBranch(input: PushBranchInput): Promise<ExternalOperationEvidence>;
  validateBranch(input: ValidateBranchInput): Promise<ValidationEvidence>;

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
  targetBranch: string;
  deliveryId: DeliveryId;
}

export interface CreateSliceBranchInput {
  repository: Repository;
  deliveryBranch: string;
  sliceId: SliceId;
}

export interface PushBranchInput {
  repository: Repository;
  branch: string;
}

export interface ValidateBranchInput {
  repository: Repository;
  branch: string;
  validationType: "slice-branch-validation" | "delivery-branch-validation" | "ship-validation";
}

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
  reason: string | null;
}

// -----------------------------------------------------------------------------
// Model Agent runtime port
// -----------------------------------------------------------------------------

export interface ModelAgentRuntimePort {
  preflightModel(input: PreflightModelRuntimeInput): Promise<ValidationEvidence>;
  runModelAgent(input: RunModelAgentInput): Promise<RunModelAgentResult>;
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
  correctionEvidence: ActionEvidence[] | null;

  artifactContext: AgentRunArtifactContext | null;
  timeoutMs: number | null;
}

export interface ResolvedModelProviderAuth {
  apiKey: string | null;
  headers: ResolvedModelProviderHeader[];
}

export interface ResolvedModelProviderHeader {
  name: string;

  /** Plaintext exists only transiently. */
  value: string;
}

export type AgentRunArtifactContext = {
  type: "source-control";
  repository: Repository;
  branch: string;
};

export interface RunModelAgentResult {
  summary: string;
  evidence: AgentRunEvidence;

  /** Reference to sandbox output. Core evaluates/promotes through Actions. */
  sandboxOutputRef: string | null;
}

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
    | { type: "delivery"; deliveryId: DeliveryId }
    | { type: "execution"; executionId: ExecutionId };
}

export interface ResolveSecretValuesInput {
  secretIds: SecretId[];
}

export interface ResolvedSecret {
  secretId: SecretId;
  environmentVariableName: string | null;

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
  | { type: "execution-started"; executionId: ExecutionId }
  | { type: "execution-paused-for-decision"; executionId: ExecutionId; decisionId: DecisionId }
  | { type: "agent-run-started"; agentRunId: AgentRunId }
  | { type: "review-surface-created"; reviewSurfaceId: ReviewSurfaceId }
  | { type: "revision-gate-opened"; revisionGateId: RevisionGateId };

export interface CoreLogger {
  debug(message: string, context: Record<string, unknown> | null): void;
  info(message: string, context: Record<string, unknown> | null): void;
  warn(message: string, context: Record<string, unknown> | null): void;
  error(message: string, context: Record<string, unknown> | null): void;
}
