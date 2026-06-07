/*
 * Gorchestra core API sketch.
 *
 * This file is documentation-by-type, not an implementation contract yet.
 * It describes how consumers call Portfolio-scoped core operations and how core
 * calls consumer-provided ports for storage, source control, missions, secrets,
 * and snapshot encryption.
 *
 * Consumers authorize operations before calling core. Core enforces core
 * invariants and owns orchestration behavior inside the opened Portfolio space.
 */

import type {
  Action,
  ActionEvidence,
  ActionId,
  LocalActorRef,
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
  Goal,
  GoalId,
  InstructionSource,
  IsoDateTime,
  Link,
  LinkId,
  Memory,
  MemoryId,
  Mission,
  MissionEvidence,
  MissionId,
  Plan,
  PlanId,
  PlanOutputProposal,
  PortfolioSnapshotManifest,
  Project,
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
  correlationId?: string;
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
  | { type: "preflight-failed"; deliveryId: DeliveryId; evidence: ValidationEvidence[] }
  | { type: "terminal-delivery"; deliveryId: DeliveryId }
  | { type: "dependency-blocked"; deliveryId: DeliveryId; blockedBy: DeliveryId[] }
  | { type: "revision-gate-closed"; revisionGateId: RevisionGateId }
  | { type: "external-operation-failed"; evidence: ExternalOperationEvidence };

// -----------------------------------------------------------------------------
// Consumer -> core commands
// -----------------------------------------------------------------------------

export interface CoreCommands {
  // Planning
  createGoal(input: CreateGoalInput, context: OperationContext): Promise<Result<Goal>>;
  createPlan(input: CreatePlanInput, context: OperationContext): Promise<Result<Plan>>;
  acceptPlanOutput(input: AcceptPlanOutputInput, context: OperationContext): Promise<Result<AcceptPlanOutputResult>>;
  rejectPlanOutput(input: RejectPlanOutputInput, context: OperationContext): Promise<Result<void>>;

  // Execution
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

export interface CreateGoalInput {
  body: string;
}

export interface CreatePlanInput {
  title: string;
}

export interface AcceptPlanOutputInput {
  planId: PlanId;

  /** Proposal shape produced by a Planning Mission; not stored as a Portfolio artifact. */
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
  reason?: string;
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

  /** Proposal shape produced by a revision planning Mission; not stored as a Portfolio artifact. */
  output: RevisionOutputProposal;
}

export interface AcceptRevisionOutputResult {
  revision: Revision;
}

export interface CloseRevisionGateInput {
  revisionGateId: RevisionGateId;
  reason?: string;
}

export interface ShipDeliveryInput {
  deliveryId: DeliveryId;
}

export interface ShipDeliveryResult {
  delivery: Delivery;
}

export interface AbandonDeliveryInput {
  deliveryId: DeliveryId;
  reason?: string;
}

export interface AbandonDeliveryResult {
  delivery: Delivery;
}

export interface CreateProjectInput {
  title: string;
  config: ProjectConfig;
}

export interface UpdateProjectConfigInput {
  projectId: ProjectId;
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

export interface SetExecutionPolicyInput {
  projectId: ProjectId;
  maxParallelSlicesPerDelivery: number;
  maxCorrectionRetries: number;
  missionTimeoutMs: number;
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
  environmentVariableName?: string;
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
  getProject(id: ProjectId): Promise<Project | undefined>;
  listProjects(): Promise<Project[]>;

  getRepository(id: RepositoryId): Promise<Repository | undefined>;
  listRepositories(filter?: RepositoryFilter): Promise<Repository[]>;

  getGoal(id: GoalId): Promise<Goal | undefined>;
  listGoals(): Promise<Goal[]>;

  getPlan(id: PlanId): Promise<Plan | undefined>;
  listPlans(): Promise<Plan[]>;

  getDelivery(id: DeliveryId): Promise<Delivery | undefined>;
  listDeliveries(filter?: DeliveryFilter): Promise<Delivery[]>;

  getSlice(id: SliceId): Promise<Slice | undefined>;
  listSlices(deliveryId: DeliveryId): Promise<Slice[]>;

  getReviewSurface(id: ReviewSurfaceId): Promise<ReviewSurface | undefined>;
  listReviewSurfaces(scope: ReviewSurfaceScope): Promise<ReviewSurface[]>;
  getCurrentReviewSurface(scope: ReviewSurfaceScope): Promise<ReviewSurface | undefined>;

  getRevision(id: RevisionId): Promise<Revision | undefined>;
  listRevisions(scope: RevisionScope): Promise<Revision[]>;

  getTimeline(filter?: TimelineFilter): Promise<TimelineEvent[]>;
}

export interface RepositoryFilter {
  projectId?: ProjectId;
}

export interface DeliveryFilter {
  projectId?: ProjectId;
  terminal?: "active" | "shipped" | "abandoned";
}

export interface TimelineFilter {
  deliveryId?: DeliveryId;
  sliceId?: SliceId;
  since?: IsoDateTime;
  until?: IsoDateTime;
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
  missionRuntime: MissionRuntimePort;
  secrets: SecretResolutionPort;
  snapshotEncryption: SnapshotEncryptionPort;
  events?: CoreEventSink;
  logger?: CoreLogger;
}

// -----------------------------------------------------------------------------
// Storage port
// -----------------------------------------------------------------------------

export interface CoreStorage {
  transaction<T>(fn: (tx: CoreStorageTransaction) => Promise<T>): Promise<T>;
}

export interface CoreStorageTransaction {
  projects: RepositoryTable<Project, ProjectId>;
  repositories: RepositoryTable<Repository, RepositoryId>;
  goals: RepositoryTable<Goal, GoalId>;
  plans: RepositoryTable<Plan, PlanId>;
  deliveries: RepositoryTable<Delivery, DeliveryId>;
  slices: RepositoryTable<Slice, SliceId>;
  links: RepositoryTable<Link, LinkId>;
  memories: RepositoryTable<Memory, MemoryId>;
  deliveryArtifacts: RepositoryTable<DeliveryArtifact, DeliveryArtifactId>;
  sliceArtifacts: RepositoryTable<SliceArtifact, SliceArtifactId>;
  executions: RepositoryTable<Execution, ExecutionId>;
  actions: RepositoryTable<Action, ActionId>;
  missions: RepositoryTable<Mission, MissionId>;
  reviewSurfaces: RepositoryTable<ReviewSurface, ReviewSurfaceId>;
  revisionGates: RepositoryTable<RevisionGate, RevisionGateId>;
  revisions: RepositoryTable<Revision, RevisionId>;
  secrets: RepositoryTable<Secret, SecretId>;
  secretBindings: RepositoryTable<SecretBinding, SecretBindingId>;
  executionPolicies: RepositoryTable<ExecutionPolicy, ExecutionPolicyId>;
}

export interface RepositoryTable<T, Id> {
  get(id: Id): Promise<T | undefined>;
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
  reason?: string;
}

// -----------------------------------------------------------------------------
// Mission runtime port
// -----------------------------------------------------------------------------

export interface MissionRuntimePort {
  runMission(input: RunMissionInput): Promise<RunMissionResult>;
}

export interface RunMissionInput {
  mission: Mission;

  /** Slice execution or Revision execution instructions. */
  instruction?: InstructionSource;

  /** Validation/external operation failures can be passed to a correction Mission. */
  correctionEvidence?: ActionEvidence[];

  artifactContext?: MissionArtifactContext;
  timeoutMs?: number;
}

export type MissionArtifactContext = {
  type: "source-control";
  repository: Repository;
  branch: string;
};

export interface RunMissionResult {
  summary: string;
  evidence: MissionEvidence;

  /** Reference to sandbox output. Core evaluates/promotes through Actions. */
  sandboxOutputRef?: string;
}

// -----------------------------------------------------------------------------
// Secret resolution port
// -----------------------------------------------------------------------------

export interface SecretResolutionPort {
  resolveSecrets(input: ResolveSecretsInput): Promise<ResolvedSecret[]>;
}

export interface ResolveSecretsInput {
  scope:
    | { type: "project"; projectId: ProjectId }
    | { type: "delivery"; deliveryId: DeliveryId }
    | { type: "execution"; executionId: ExecutionId };
}

export interface ResolvedSecret {
  secretId: SecretId;
  environmentVariableName?: string;

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
  | { type: "review-surface-created"; reviewSurfaceId: ReviewSurfaceId }
  | { type: "revision-gate-opened"; revisionGateId: RevisionGateId };

export interface CoreLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
