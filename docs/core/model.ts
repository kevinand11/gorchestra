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
export type PlanId = Brand<string, "PlanId">;
export type DeliveryId = Brand<string, "DeliveryId">;
export type SliceId = Brand<string, "SliceId">;
export type MemoryId = Brand<string, "MemoryId">;
export type LinkId = Brand<string, "LinkId">;
export type SecretId = Brand<string, "SecretId">;
export type SecretBindingId = Brand<string, "SecretBindingId">;
export type ActionId = Brand<string, "ActionId">;
export type AgentRunId = Brand<string, "AgentRunId">;
export type DecisionId = Brand<string, "DecisionId">;
export type RevisionGateId = Brand<string, "RevisionGateId">;
export type RevisionId = Brand<string, "RevisionId">;
export type ReviewSurfaceId = Brand<string, "ReviewSurfaceId">;
export type DeliveryArtifactId = Brand<string, "DeliveryArtifactId">;
export type SliceArtifactId = Brand<string, "SliceArtifactId">;
export type SnapshotId = Brand<string, "SnapshotId">;
export type ModelProviderId = Brand<string, "ModelProviderId">;
export type ModelId = Brand<string, "ModelId">;

export type IsoDateTime = string;

/**
 * Unless explicitly noted otherwise:
 * - user-facing names/titles and provider-facing string identifiers are stored
 *   trimmed and must be non-empty.
 * - free-form bodies/details are stored trimmed and may be empty.
 * - collections are stored as arrays; empty arrays mean no items.
 * - operation-specific reasons, when needed, live on the specific closed state,
 *   result, or input they explain and are stored as strings that may be empty.
 * - use field: RuntimeRecord for runtime lifecycle timestamps and
 *   field: AuditedRecord for consumer-authorized operations. The embedded
 *   record contains all fields that change atomically with that lifecycle
 *   moment so half-updated states are not representable.
 */

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
  correlationId: string | null;
}

export interface ImportedAuditStamp {
  origin: "imported";

  /** Original operation time copied from the imported audit stamp. */
  at: IsoDateTime;
}

export interface RuntimeRecord {
  at: IsoDateTime;
}

export interface AuditedRecord {
  audit: AuditStamp;
}

// -----------------------------------------------------------------------------
// Project / Project Type
// -----------------------------------------------------------------------------

export interface Project {
  id: ProjectId;
  title: string;
  config: ProjectConfig;
  agentRun: ProjectAgentRunConfigRecord | null;
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
// Model Providers / Models / Agent Run Config
// -----------------------------------------------------------------------------

export interface ModelProvider {
  id: ModelProviderId;
  name: string;
  protocol: ModelProviderProtocol;

  /** Full API base URL; trailing slashes are trimmed. Must be https, except localhost/127.0.0.1 may use http. */
  baseUrl: string;

  /** Standard auth used by the protocol adapter; null means no standard auth. */
  auth: ModelProviderAuth | null;

  headers: ModelProviderHeader[];
  created: AuditStamp;
  updated: ModelProviderUpdated | null;
  archived: ModelProviderArchived | null;
}

export interface ModelProviderUpdated extends AuditedRecord {}

export interface ModelProviderArchived extends AuditedRecord {}

export type ModelProviderProtocol =
  | "anthropic-messages"
  | "openai-responses"
  | "openai-completions"
  | "google-generative-ai";

export type ModelProviderAuth = ModelProviderApiKeyAuth;

export interface ModelProviderApiKeyAuth {
  type: "apiKey";

  /** Must reference a generic Secret. */
  secretId: SecretId;
}

export interface ModelProviderHeader {
  /** Must match /^[A-Za-z0-9-]+$/; unique per provider case-insensitively. */
  name: string;

  /** Must reference a generic Secret. */
  valueSecretId: SecretId;
}

export interface Model {
  id: ModelId;
  providerId: ModelProviderId;
  name: string;
  providerModelId: string;
  created: AuditStamp;
  updated: ModelUpdated | null;
  archived: ModelArchived | null;
}

export interface ModelUpdated extends AuditedRecord {}

export interface ModelArchived extends AuditedRecord {}

export interface PortfolioConfig {
  agentRun: PortfolioAgentRunConfigRecord | null;
}

export interface PortfolioAgentRunConfigRecord extends AuditedRecord {
  config: PortfolioAgentRunConfig | null;
}

export interface ProjectAgentRunConfigRecord extends AuditedRecord {
  config: ProjectAgentRunConfig | null;
}

export interface PlanAgentRunConfigRecord extends AuditedRecord {
  config: PlanAgentRunConfig | null;
}

export interface PortfolioAgentRunConfig extends ProjectAgentRunConfig {
  defaultModelId: ModelId;
}

export interface ProjectAgentRunConfig {
  planningModelId: ModelId | null;
  revisionPlanningModelId: ModelId | null;
  executionModelId: ModelId | null;
  revisionExecutionModelId: ModelId | null;
}

export interface PlanAgentRunConfig {
  planningModelId: ModelId | null;
}

export interface DeliveryAgentRunConfig {
  revisionPlanningModelId: ModelId | null;
  executionModelId: ModelId | null;
  revisionExecutionModelId: ModelId | null;
}

/**
 * Effective Agent Run model selection is derived, not stored separately.
 *
 * planning:
 *   Plan.planningModelId
 *   -> Project.planningModelId
 *   -> Portfolio.planningModelId
 *   -> Portfolio.defaultModelId
 *
 * revision-planning:
 *   Delivery.revisionPlanningModelId
 *   -> Project.revisionPlanningModelId
 *   -> Portfolio.revisionPlanningModelId
 *   -> Portfolio.defaultModelId
 *
 * execution:
 *   Delivery.executionModelId
 *   -> Project.executionModelId
 *   -> Portfolio.executionModelId
 *   -> Portfolio.defaultModelId
 *
 * revision-execution:
 *   Delivery.revisionExecutionModelId
 *   -> Project.revisionExecutionModelId
 *   -> Portfolio.revisionExecutionModelId
 *   -> Portfolio.defaultModelId
 */
export type AgentRunModelResolution = {
  purpose: AgentRunPurpose["type"];
  selectedModelId: ModelId;
};

// -----------------------------------------------------------------------------
// Plan / Plan Output proposal shape
// -----------------------------------------------------------------------------

export interface Plan {
  id: PlanId;
  projectId: ProjectId;
  title: string;
  agentRun: PlanAgentRunConfigRecord | null;
  created: AuditStamp;
}

/**
 * PlanOutputProposal is not a stored Portfolio artifact.
 * It is the structured shape a planning Agent Run must produce.
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
  title: string;
  target: ProposedDeliveryTarget;
  slices: ProposedSlice[];
  dependsOnDeliveryIds: DeliveryId[];
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
  dependsOnProposedSliceKeys: string[];
}

export interface ProposedMemory {
  proposedMemoryKey: string;
  title: string;
  body: string;
  type: MemoryType | null;
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
  /** Immutable accepted instructions used by Agent Runs. */
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
  config: DeliveryConfigRecord | null;

  /** Every Delivery has at least one Slice. */
  sliceIds: readonly [SliceId, ...SliceId[]];

  /** Repeated readiness checks; latest relevant check contributes to derived readiness. */
  preflightChecks: PreflightCheck[];

  started: DeliveryStarted | null;

  /** Shipped and Abandoned are mutually exclusive closed outcomes. */
  closed: DeliveryClosed | null;

  accepted: AuditStamp;
}

export interface DeliveryStarted extends AuditedRecord {}

export type DeliveryClosed = DeliveryShipped | DeliveryAbandoned;

export interface DeliveryConfigRecord extends AuditedRecord {
  config: DeliveryConfig;
}

export interface DeliveryConfig {
  agentRun: DeliveryAgentRunConfig | null;
  execution: DeliveryExecutionConfig;
}

export interface DeliveryExecutionConfig {
  maxParallelSlices: number;
  maxCorrectionRetries: number;
  agentRunTimeoutMs: number;
}

export interface DeliveryShipped extends AuditedRecord {
  type: "shipped";
  reviewSurfaceId: ReviewSurfaceId;
}

export interface DeliveryAbandoned extends AuditedRecord {
  type: "abandoned";
  reason: string;
  cleanupEvidence: ExternalOperationEvidence[];
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
  archived: LinkArchived | null;
}

export interface LinkArchived extends AuditedRecord {}

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
// Action / Agent Run
// -----------------------------------------------------------------------------

export interface Action {
  id: ActionId;
  deliveryId: DeliveryId;
  performed: RuntimeRecord;
  result: ActionResult;
}

export type ActionResult =
  | { type: "preflight"; evidence: ValidationEvidence }
  | { type: "create-delivery-artifact"; deliveryArtifactId: DeliveryArtifactId }
  | { type: "start-slice"; sliceId: SliceId }
  | { type: "create-slice-artifact"; sliceId: SliceId; sliceArtifactId: SliceArtifactId }
  | { type: "start-slice-agent-run"; sliceId: SliceId; agentRunId: AgentRunId }
  | { type: "start-revision-agent-run"; revisionId: RevisionId; agentRunId: AgentRunId }
  | { type: "validate-slice-artifact"; sliceId: SliceId; evidence: ValidationEvidence }
  | { type: "create-slice-review-surface"; sliceId: SliceId; reviewSurfaceId: ReviewSurfaceId }
  | { type: "observe-slice-review-surface"; sliceId: SliceId; reviewSurfaceId: ReviewSurfaceId }
  | { type: "promote-slice-artifact"; sliceId: SliceId; evidence: ExternalOperationEvidence }
  | { type: "validate-delivery-artifact"; evidence: ValidationEvidence }
  | { type: "create-delivery-review-surface"; reviewSurfaceId: ReviewSurfaceId }
  | { type: "observe-delivery-review-surface"; reviewSurfaceId: ReviewSurfaceId }
  | { type: "run-revision"; revisionId: RevisionId; agentRunId: AgentRunId }
  | { type: "record-slice-external-operation-failure"; sliceId: SliceId; evidence: ExternalOperationEvidence }
  | { type: "record-revision-external-operation-failure"; revisionId: RevisionId; evidence: ExternalOperationEvidence }
  | { type: "record-delivery-external-operation-failure"; evidence: ExternalOperationEvidence };

export interface AgentRun {
  id: AgentRunId;
  agent: Agent;
  purpose: AgentRunPurpose;
  started: RuntimeRecord;
  completed: RuntimeRecord | null;
}

export type Agent = ModelAgent;

export interface ModelAgent {
  type: "model";
  modelId: ModelId;
}

export type AgentRunPurpose =
  | { type: "planning"; planId: PlanId }
  | { type: "revision-planning"; revisionGateId: RevisionGateId }
  | { type: "execution"; actionId: ActionId }
  | { type: "revision-execution"; revisionId: RevisionId; actionId: ActionId };

export interface AgentRunSandbox {
  agentRunId: AgentRunId;
  type: "worktree" | "temporary-files" | "other";
  locationRef: string | null;
}

// -----------------------------------------------------------------------------
// Evidence / validation / external operation failures
// -----------------------------------------------------------------------------

export type CorrectionEvidence = ValidationEvidence | ExternalOperationEvidence;

export interface ValidationEvidence {
  type: "validation";
  validationType:
    | "preflight"
    | "model-preflight"
    | "slice-branch-validation"
    | "delivery-branch-validation"
    | "ship-validation";
  passed: boolean;
  summary: string;
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
  provider: SourceControlProvider | null;
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

  /** Merged, closed-without-merge, and replaced are mutually exclusive closed outcomes. */
  closed: ReviewSurfaceClosed | null;

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

export type ReviewSurfaceClosed =
  | ReviewSurfaceMerged
  | ReviewSurfaceClosedWithoutMerge
  | ReviewSurfaceReplaced;

export interface ReviewSurfaceMerged extends AuditedRecord {
  type: "merged";
  config: ReviewSurfaceMergedConfig;
}

export type ReviewSurfaceMergedConfig = SourceControlReviewSurfaceMergedConfig;

export interface SourceControlReviewSurfaceMergedConfig {
  type: "source-control";
  repositoryId: RepositoryId;
  sourceBranch: string;
  targetBranch: string;
}

export interface ReviewSurfaceClosedWithoutMerge extends AuditedRecord {
  type: "closed-without-merge";
}

export interface ReviewSurfaceReplaced extends AuditedRecord {
  type: "replaced";
  reviewSurfaceId: ReviewSurfaceId;
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
  createdAt: IsoDateTime | null;
  updatedAt: IsoDateTime | null;
}

export type FetchedFeedbackConfig = GitHubFetchedFeedbackConfig;
export type FetchedFeedbackProvider = FetchedFeedbackConfig["provider"];

export interface GitHubFetchedFeedbackConfig {
  provider: "github";
  externalFeedbackId: string;
  author: string | null;
  url: string | null;
}

export type RevisionScope =
  | { type: "slice-artifact"; sliceId: SliceId; sliceArtifactId: SliceArtifactId }
  | { type: "delivery-artifact"; deliveryId: DeliveryId; deliveryArtifactId: DeliveryArtifactId };

export interface RevisionGate {
  id: RevisionGateId;
  scope: RevisionScope;
  reviewSurfaceId: ReviewSurfaceId;
  opened: AuditStamp;
  closed: RevisionGateClosed | null;

  /** Set when a Revision Output is accepted and Revision is created. */
  consumedByRevisionId: RevisionId | null;
}

export interface RevisionGateClosed extends AuditedRecord {}

/**
 * RevisionOutputProposal is not a stored Portfolio artifact.
 * It is the structured shape a revision-planning Agent Run must produce.
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
  type: MemoryType | null;
  created: AuditStamp;
}

// -----------------------------------------------------------------------------
// Secrets
// -----------------------------------------------------------------------------

export type SecretType = "github-pat" | "generic";

export interface Secret {
  id: SecretId;
  type: SecretType;
  name: string;

  /** Consumer-specific protected value reference. Core never exposes/logs plaintext. */
  valueRef: string;

  created: AuditStamp;
  replaced: SecretReplaced | null;
}

export interface SecretReplaced extends AuditedRecord {}

export type SecretBindingScope =
  | { type: "portfolio" }
  | { type: "project"; projectId: ProjectId }
  | { type: "delivery"; deliveryId: DeliveryId };

export interface SecretBinding {
  id: SecretBindingId;
  secretId: SecretId;
  scope: SecretBindingScope;

  /** Must match /^[A-Z_][A-Z0-9_]*$/. */
  envName: string;

  created: AuditStamp;
  archived: SecretBindingArchived | null;
}

export interface SecretBindingArchived extends AuditedRecord {}

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
  envName: string;
  secretId: SecretId;
}>;

// -----------------------------------------------------------------------------
// Decision
// -----------------------------------------------------------------------------

export interface Decision {
  id: DecisionId;

  source:
    | { type: "planning"; agentRunId: AgentRunId }
    | { type: "delivery-execution"; deliveryId: DeliveryId; actionId: ActionId | null }
    | { type: "revision-planning"; revisionGateId: RevisionGateId };

  summary: string;
  body: string;
  raised: AuditStamp;
  resolved: DecisionResolved | null;
}

export interface DecisionResolved extends AuditedRecord {}

// -----------------------------------------------------------------------------
// Preflight
// -----------------------------------------------------------------------------

export interface PreflightCheck extends RuntimeRecord {
  passed: boolean;
  summary: string;
  evidence: ValidationEvidence[];
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
