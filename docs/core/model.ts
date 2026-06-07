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

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ProjectId = Brand<string, "ProjectId">;
export type RepositoryId = Brand<string, "RepositoryId">;
export type GoalId = Brand<string, "GoalId">;
export type PlanId = Brand<string, "PlanId">;
export type DeliveryId = Brand<string, "DeliveryId">;
export type SliceId = Brand<string, "SliceId">;
export type MemoryId = Brand<string, "MemoryId">;
export type LinkId = Brand<string, "LinkId">;
export type SecretId = Brand<string, "SecretId">;
export type SecretBindingId = Brand<string, "SecretBindingId">;
export type ExecutionId = Brand<string, "ExecutionId">;
export type ExecutionPolicyId = Brand<string, "ExecutionPolicyId">;
export type ActionId = Brand<string, "ActionId">;
export type MissionId = Brand<string, "MissionId">;
export type DecisionId = Brand<string, "DecisionId">;
export type RevisionGateId = Brand<string, "RevisionGateId">;
export type RevisionId = Brand<string, "RevisionId">;
export type ReviewSurfaceId = Brand<string, "ReviewSurfaceId">;
export type DeliveryArtifactId = Brand<string, "DeliveryArtifactId">;
export type SliceArtifactId = Brand<string, "SliceArtifactId">;
export type SnapshotId = Brand<string, "SnapshotId">;

export type IsoDateTime = string;

export interface LocalActorRef {
  /** Consumer-defined actor category, such as "workspace-member" or "local-user". */
  type: string;

  /** Consumer-local actor identifier. Core stores this opaquely and never interprets it. */
  id: string;
}

export type AuditStamp = LocalAuditStamp | ImportedAuditStamp;

export interface LocalAuditStamp {
  origin: "local";
  at: IsoDateTime;
  actor: LocalActorRef;
  correlationId?: string;
}

export interface ImportedAuditStamp {
  origin: "imported";

  /** Original operation time copied from the imported audit stamp. */
  at: IsoDateTime;
}

// -----------------------------------------------------------------------------
// Project / Project Type
// -----------------------------------------------------------------------------

export interface Project {
  id: ProjectId;
  title: string;
  config: ProjectConfig;
  created: AuditStamp;
}

export type ProjectConfig = SourceControlProjectConfig;
export type ProjectType = ProjectConfig["type"];

export interface SourceControlProjectConfig {
  type: "source-control";
}

// -----------------------------------------------------------------------------
// Repository
// -----------------------------------------------------------------------------

export interface Repository {
  id: RepositoryId;
  projectId: ProjectId;
  config: RepositoryConfig;
  created: AuditStamp;
}

export type RepositoryConfig = GitHubRepositoryConfig;
export type SourceControlProvider = RepositoryConfig["provider"];

export interface GitHubRepositoryConfig {
  provider: "github";
  owner: string;
  name: string;
}

// -----------------------------------------------------------------------------
// Goal / Plan / Plan Output proposal shape
// -----------------------------------------------------------------------------

export interface Goal {
  id: GoalId;
  body: string;
  created: AuditStamp;
}

export interface Plan {
  id: PlanId;
  title: string;
  created: AuditStamp;
}

/**
 * PlanOutputProposal is not a stored Portfolio artifact.
 * It is the structured shape a Planning Mission must produce.
 * Accepting it materializes Deliveries, Slices, Memories, Links, and Slice Instruction Sources.
 */
export interface PlanOutputProposal {
  planId: PlanId;
  proposedDeliveries: ProposedDelivery[];
  proposedMemories: ProposedMemory[];
  proposedLinks: ProposedLink[];
}

export interface ProposedDelivery {
  proposedDeliveryKey: string;
  projectId: ProjectId;
  title: string;
  target: ProposedDeliveryTarget;
  slices: ProposedSlice[];
  dependsOnDeliveryIds?: DeliveryId[];
}

export type ProposedDeliveryTarget = ProposedSourceControlDeliveryTarget;

export interface ProposedSourceControlDeliveryTarget {
  type: "source-control";
  repositoryId: RepositoryId;

  /** Immutable after Delivery acceptance. */
  targetBranch: string;
}

export interface ProposedSlice {
  proposedSliceKey: string;
  title: string;

  /** Becomes the materialized Slice's immutable Instruction Source. */
  instruction: InstructionSource;

  /** Same-Delivery dependencies only. */
  dependsOnProposedSliceKeys?: string[];
}

export interface ProposedMemory {
  proposedMemoryKey: string;
  title: string;
  body: string;
  type?: MemoryType;
}

export interface ProposedLink {
  type: LinkType;
  from: ProposedGraphRef;
  to: ProposedGraphRef;
}

export type ProposedGraphRef =
  | { type: "existing"; node: GraphNodeRef }
  | { type: "proposed-delivery"; proposedDeliveryKey: string }
  | { type: "proposed-slice"; proposedSliceKey: string }
  | { type: "proposed-memory"; proposedMemoryKey: string };

// -----------------------------------------------------------------------------
// Instruction Source
// -----------------------------------------------------------------------------

export interface InstructionSource {
  /** Immutable accepted instructions used by Missions. */
  body: string;
}

// -----------------------------------------------------------------------------
// Delivery / Slice
// -----------------------------------------------------------------------------

export interface Delivery {
  id: DeliveryId;
  projectId: ProjectId;
  planId: PlanId;
  title: string;
  target: DeliveryTarget;

  /** Every Delivery has at least one Slice. */
  sliceIds: readonly [SliceId, ...SliceId[]];

  /** Repeated readiness checks; latest relevant check contributes to derived readiness. */
  preflightChecks?: PreflightCheck[];

  /** Shipped and Abandoned are mutually exclusive terminal outcomes. */
  terminal?: DeliveryTerminalOutcome;

  accepted: AuditStamp;
}

export type DeliveryTerminalOutcome = DeliveryShipped | DeliveryAbandoned;

export interface DeliveryShipped {
  type: "shipped";
  recorded: AuditStamp;
  reviewSurfaceId?: ReviewSurfaceId;
}

export interface DeliveryAbandoned {
  type: "abandoned";
  recorded: AuditStamp;
  reason?: string;
  cleanupEvidence?: ExternalOperationEvidence[];
}

export type DeliveryTarget = SourceControlDeliveryTarget;

export interface SourceControlDeliveryTarget {
  type: "source-control";
  repositoryId: RepositoryId;

  /** Immutable. Delivery Branch is created from this and merged back into it on Ship. */
  targetBranch: string;
}

export interface Slice {
  id: SliceId;
  deliveryId: DeliveryId;
  title: string;

  /** Immutable after Plan Output acceptance. */
  instruction: InstructionSource;

  accepted: AuditStamp;
}

// -----------------------------------------------------------------------------
// Links / Graph
// -----------------------------------------------------------------------------

export type GraphNodeRef =
  | { type: "goal"; id: GoalId }
  | { type: "plan"; id: PlanId }
  | { type: "project"; id: ProjectId }
  | { type: "delivery"; id: DeliveryId }
  | { type: "slice"; id: SliceId }
  | { type: "memory"; id: MemoryId };

export type LinkType =
  | "produced"
  | "implements"
  | "references"
  | "supersedes"
  | "supports"
  | "contradicts"
  | "depends-on";

export interface Link {
  id: LinkId;
  type: LinkType;
  from: GraphNodeRef;
  to: GraphNodeRef;
  created: AuditStamp;

  /** Only archivable Link types may set this. */
  archived?: AuditStamp;
}

// -----------------------------------------------------------------------------
// Artifacts
// -----------------------------------------------------------------------------

export interface DeliveryArtifact {
  id: DeliveryArtifactId;
  deliveryId: DeliveryId;
  config: DeliveryArtifactConfig;
  created: AuditStamp;
}

export type DeliveryArtifactConfig = SourceControlDeliveryArtifactConfig;
export type DeliveryArtifactType = DeliveryArtifactConfig["type"];

export interface SourceControlDeliveryArtifactConfig {
  type: "source-control";
  repositoryId: RepositoryId;
  deliveryBranch: string;
  targetBranch: string;
}

export interface SliceArtifact {
  id: SliceArtifactId;
  sliceId: SliceId;
  config: SliceArtifactConfig;
  created: AuditStamp;
}

export type SliceArtifactConfig = SourceControlSliceArtifactConfig;
export type SliceArtifactType = SliceArtifactConfig["type"];

export interface SourceControlSliceArtifactConfig {
  type: "source-control";
  repositoryId: RepositoryId;
  sliceBranch: string;
  deliveryBranch: string;
}

// -----------------------------------------------------------------------------
// Execution Policy
// -----------------------------------------------------------------------------

export interface ExecutionPolicy {
  id: ExecutionPolicyId;
  projectId: ProjectId;
  version: number;

  /** v1 minimal policy. */
  maxParallelSlicesPerDelivery: number;
  maxCorrectionRetries: number;
  missionTimeoutMs: number;

  created: AuditStamp;
}

// -----------------------------------------------------------------------------
// Execution / Action / Mission
// -----------------------------------------------------------------------------

export interface Execution {
  id: ExecutionId;
  deliveryId: DeliveryId;

  /** Captured when Execution starts. */
  executionPolicyId: ExecutionPolicyId;
  executionPolicyVersion: number;

  started: AuditStamp;
  endedAt?: IsoDateTime;
}

export type ActionType =
  | "preflight"
  | "create-delivery-artifact"
  | "start-slice"
  | "create-slice-artifact"
  | "run-mission"
  | "promote-mission-output"
  | "validate-slice-artifact"
  | "create-slice-review-surface"
  | "observe-slice-review-surface"
  | "promote-slice-artifact"
  | "validate-delivery-artifact"
  | "create-delivery-review-surface"
  | "observe-delivery-review-surface"
  | "run-revision"
  | "record-external-operation-failure"
  | "raise-decision";

export interface Action {
  id: ActionId;
  executionId: ExecutionId;
  deliveryId: DeliveryId;
  sliceId?: SliceId;
  revisionId?: RevisionId;
  type: ActionType;
  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  outcome?: ActionOutcome;
}

export type ActionOutcome =
  | { type: "succeeded"; evidence?: ActionEvidence[] }
  | { type: "failed"; evidence: ActionEvidence[] }
  | { type: "requires-decision"; decisionId: DecisionId };

export interface Mission {
  id: MissionId;
  executionId?: ExecutionId;

  purpose:
    | { type: "planning"; planId: PlanId }
    | { type: "revision-planning"; revisionGateId: RevisionGateId }
    | { type: "execution"; actionId: ActionId }
    | { type: "revision-execution"; revisionId: RevisionId; actionId: ActionId };

  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  traceRef?: string;
  toolDataRef?: string;
}

export interface MissionSandbox {
  missionId: MissionId;
  type: "worktree" | "temporary-files" | "other";
  locationRef?: string;
}

// -----------------------------------------------------------------------------
// Evidence / validation / external operation failures
// -----------------------------------------------------------------------------

export type ActionEvidence = ValidationEvidence | ExternalOperationEvidence | MissionEvidence;

export interface ValidationEvidence {
  type: "validation";
  validationType:
    | "preflight"
    | "slice-branch-validation"
    | "delivery-branch-validation"
    | "ship-validation";
  passed: boolean;
  summary: string;
  detailsRef?: string;
}

export interface ExternalOperationEvidence {
  type: "external-operation";
  operation:
    | "push-branch"
    | "create-review-surface"
    | "merge-review-surface"
    | "close-review-surface"
    | "fetch-feedback";
  passed: boolean;
  summary: string;
  provider?: SourceControlProvider;
  detailsRef?: string;
}

export interface MissionEvidence {
  type: "mission";
  missionId: MissionId;
  summary: string;
  detailsRef?: string;
}

// -----------------------------------------------------------------------------
// Review Surface
// -----------------------------------------------------------------------------

export type ReviewSurfaceScope =
  | { type: "slice"; sliceId: SliceId; sliceArtifactId: SliceArtifactId }
  | { type: "delivery"; deliveryId: DeliveryId; deliveryArtifactId: DeliveryArtifactId };

export interface ReviewSurface {
  id: ReviewSurfaceId;
  scope: ReviewSurfaceScope;
  config: ReviewSurfaceConfig;

  /** Required creation metadata only. No labels/assignees/reviewers/comments in v1. */
  title: string;
  body: string;

  /** Merged, closed-without-merge, and replaced are mutually exclusive terminal outcomes. */
  terminal?: ReviewSurfaceTerminalOutcome;

  created: AuditStamp;
}

export type ReviewSurfaceConfig = GitHubPullRequestReviewSurfaceConfig;
export type ReviewSurfaceProvider = ReviewSurfaceConfig["provider"];

export interface GitHubPullRequestReviewSurfaceConfig {
  provider: "github";

  /** GitHub pull request identity within the repository. */
  pullRequestNumber: number;

  /** Source Control facts. */
  repositoryId: RepositoryId;
  sourceBranch: string;
  targetBranch: string;
}

export type ReviewSurfaceTerminalOutcome =
  | ReviewSurfaceMerged
  | ReviewSurfaceClosedWithoutMerge
  | ReviewSurfaceReplaced;

export interface ReviewSurfaceMerged {
  type: "merged";
  recorded: AuditStamp;
  config: ReviewSurfaceMergedConfig;
}

export type ReviewSurfaceMergedConfig = SourceControlReviewSurfaceMergedConfig;

export interface SourceControlReviewSurfaceMergedConfig {
  type: "source-control";
  repositoryId: RepositoryId;
  sourceBranch: string;
  targetBranch: string;
}

export interface ReviewSurfaceClosedWithoutMerge {
  type: "closed-without-merge";
  recorded: AuditStamp;
}

export interface ReviewSurfaceReplaced {
  type: "replaced";
  recorded: AuditStamp;
  reviewSurfaceId: ReviewSurfaceId;
  reason?: string;
}

// -----------------------------------------------------------------------------
// Feedback / Revision Gate / Revision Output proposal shape / Revision
// -----------------------------------------------------------------------------

/**
 * Feedback is fetched from the current Review Surface.
 * It is not stored as authoritative Portfolio data in v1.
 */
export interface FetchedFeedback {
  reviewSurfaceId: ReviewSurfaceId;
  config: FetchedFeedbackConfig;
  body: string;
  createdAt?: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export type FetchedFeedbackConfig = GitHubFetchedFeedbackConfig;
export type FetchedFeedbackProvider = FetchedFeedbackConfig["provider"];

export interface GitHubFetchedFeedbackConfig {
  provider: "github";
  externalFeedbackId: string;
  author?: string;
  url?: string;
}

export type RevisionScope =
  | { type: "slice-artifact"; sliceId: SliceId; sliceArtifactId: SliceArtifactId }
  | { type: "delivery-artifact"; deliveryId: DeliveryId; deliveryArtifactId: DeliveryArtifactId };

export interface RevisionGate {
  id: RevisionGateId;
  scope: RevisionScope;
  reviewSurfaceId: ReviewSurfaceId;
  opened: AuditStamp;
  closed?: AuditStamp;

  /** Set when a Revision Output is accepted and Revision is created. */
  consumedByRevisionId?: RevisionId;
}

/**
 * RevisionOutputProposal is not a stored Portfolio artifact.
 * It is the structured shape a revision planning Mission must produce.
 */
export interface RevisionOutputProposal {
  revisionGateId: RevisionGateId;
  scope: RevisionScope;
  instruction: InstructionSource;

  /** Human-readable account of how fetched Feedback is handled. */
  disposition: RevisionDisposition;
}

export interface Revision {
  id: RevisionId;
  revisionGateId: RevisionGateId;
  scope: RevisionScope;
  instruction: InstructionSource;
  disposition: RevisionDisposition;
  accepted: AuditStamp;
}

export interface RevisionDisposition {
  /** Immutable human-readable account of how the Revision responds to fetched Feedback. */
  body: string;
}

// -----------------------------------------------------------------------------
// Memory
// -----------------------------------------------------------------------------

export type MemoryType =
  | "decision"
  | "fact"
  | "constraint"
  | "assumption"
  | "risk"
  | "architecture"
  | "workflow"
  | "convention"
  | (string & {});

export interface Memory {
  id: MemoryId;
  title: string;
  body: string;
  type?: MemoryType;
  created: AuditStamp;
}

// -----------------------------------------------------------------------------
// Secrets
// -----------------------------------------------------------------------------

export type SecretType = "github-pat" | "environment-variable" | "generic";

export interface Secret {
  id: SecretId;
  type: SecretType;
  name: string;

  /** Consumer-specific protected value reference. Core never exposes/logs plaintext. */
  valueRef: string;

  created: AuditStamp;
  replaced?: AuditStamp;
}

export type SecretBindingScope =
  | { type: "portfolio" }
  | { type: "project"; projectId: ProjectId }
  | { type: "delivery"; deliveryId: DeliveryId }
  | { type: "execution"; executionId: ExecutionId };

export interface SecretBinding {
  id: SecretBindingId;
  secretId: SecretId;
  scope: SecretBindingScope;
  environmentVariableName?: string;
  created: AuditStamp;
  archived?: AuditStamp;
}

// -----------------------------------------------------------------------------
// Decision
// -----------------------------------------------------------------------------

export interface Decision {
  id: DecisionId;

  source:
    | { type: "planning"; missionId: MissionId }
    | { type: "execution"; executionId: ExecutionId; actionId?: ActionId }
    | { type: "revision-planning"; revisionGateId: RevisionGateId };

  summary: string;
  details?: string;
  raised: AuditStamp;
  resolved?: AuditStamp;
}

// -----------------------------------------------------------------------------
// Preflight
// -----------------------------------------------------------------------------

export interface PreflightCheck {
  passed: boolean;
  summary: string;
  evidence?: ValidationEvidence[];
  checkedAt: IsoDateTime;
}

// -----------------------------------------------------------------------------
// Portfolio Snapshot
// -----------------------------------------------------------------------------

export interface PortfolioSnapshotManifest {
  id: SnapshotId;
  snapshotVersion: string;
  exported: AuditStamp;

  /** Passphrase-encrypted payload containing Portfolio storage contents. */
  encryptedPayloadRef: string;
}
