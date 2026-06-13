# Gorchestra Core

The Gorchestra core is the reusable Portfolio-level orchestration context. It manages Portfolio data, planning, graph relationships, delivery execution, portable Portfolio Snapshots, and Project-level work without depending on server-app tenancy concepts.

## Language

**Portfolio**:
A core orchestration boundary that groups Projects and shared reusable context or resources such as Memories and Secret Bindings.
_Avoid_: Project Space, program, workspace

**Local Actor Ref**:
An opaque consumer-supplied reference to the actor associated with a local core operation. A Local Actor Ref contains a consumer-defined actor type and actor id. Core validates only that these values are strings, stores them exactly as supplied for attribution, and does not inspect, trim, or interpret their contents.
_Avoid_: User, Workspace Member, account

**Audit Stamp**:
The recorded operation time and attribution metadata attached to attribution-bearing core records or outcomes. A local Audit Stamp contains a Local Actor Ref and optional opaque correlation id stored exactly as supplied by the Consumer; an imported Audit Stamp preserves the original operation time while marking attribution as not locally resolvable.
_Avoid_: createdBy field, Workspace Member field

**Archive Period**:
A lifecycle record containing the Audit Stamp that archived a record and, when later reactivated, the Audit Stamp that unarchived it. Current archival state is derived from whether the latest Archive Period has no unarchived stamp.
_Avoid_: archived flag, deleted flag

**Core Input**:
A value a Consumer passes through a public core API boundary, including command inputs, query arguments, Snapshot operation inputs, Operation Context values, and Open Core options.
_Avoid_: payload, request body, port result

**Core Orchestration API**:
The public Core command/query surface for operations that Core runtime or orchestration behavior needs to enforce Core-owned invariants, perform work, or record lifecycle facts. Consumers may use their own storage access or projections for non-orchestration UI/admin views, but mutations that affect Core invariants or lifecycle facts go through Core commands.
_Avoid_: UI API, admin API, storage API

**Core Service**:
A consumer-provided deployment boundary used by Core for mechanics such as storage, Secret-at-rest protection and plaintext resolution, sandbox isolation, Clock, ID generation, logging, or event publishing. Core Services do not own Portfolio orchestration, Source Control Provider, Model Provider Protocol, Agent Run behavior, or portable Snapshot encryption.
_Avoid_: Core Port, plugin, consumer policy, integration logic

**Core Service Output**:
A value returned to Core by a Core Service. Core validates Core Service Outputs before trusting them; notification-only services such as logging or event publishing do not produce Core Service Outputs. Malformed readiness outputs from required Core Services are reported as invalid Core Service Outputs rather than failed readiness.
_Avoid_: Core Input, provider behavior, consumer policy

**Invalid Core Input**:
A Core Input rejected before core behavior runs because it fails the declared input pipe for that public core API boundary.
_Avoid_: invariant violation, domain failure, malformed request

**Operation Error Union**:
An operation-specific exported union of only the error variants a public Core operation can return.
_Avoid_: full CoreError return, catch-all error type

**Secret**:
A Portfolio-owned named sensitive value whose stored record includes a protected value reference but never plaintext. Users may create, replace, and archive Secret values, and Core may return Secret records from write operations, but users may not view plaintext values after creation; v1 Secrets do not have provider-specific Secret types.
_Avoid_: Credential, token, key, sensitive value

**Protected Secret Value Reference**:
A consumer-specific protected reference to Secret plaintext that may be stored and returned by Core because it is not plaintext.
_Avoid_: Plaintext secret, decrypted secret value

**Environment Variable**:
A Secret exposed to Agent Runs as a named runtime environment variable through a Secret Binding.
_Avoid_: Environment, environment secret

**Secret Binding**:
A Portfolio-owned archivable rule that exposes a Secret to Agent Runs as a named environment variable at a Portfolio, Project, or Delivery boundary; no two Secret Bindings may share the same exact scope and environment variable name, even when one is archived.
_Avoid_: Secret Assignment, credential assignment

**GitHub PAT**:
A personal access token value a user may store as a Secret for GitHub Repository access. GitHub PAT is not a separate Secret type in v1.
_Avoid_: GitHub token, GitHub credential

**Portfolio Snapshot**:
A Core-encrypted portable artifact containing Portfolio storage contents. Portfolio Snapshots always include Secrets and can be restored by any Gorchestra consumer with the passphrase.
_Avoid_: Backup, dump, workspace export

**Export**:
The operation that creates a passphrase-encrypted Portfolio Snapshot from the currently-open Portfolio using Core-owned snapshot encryption behavior.
_Avoid_: Backup, dump

**Restore**:
The operation that replaces the currently-open Portfolio contents with a Core-encrypted Portfolio Snapshot using its passphrase.
_Avoid_: Import, upload, merge

**Project**:
An orchestration boundary inside a Portfolio where Gorchestra executes Deliveries against one or more execution targets. Project-specific planning context is expressed through Project-level Plans and Links to Portfolio-owned Memories.
_Avoid_: Repository, repo

**Project Source**:
The immutable configured execution source a Project manages. A Project Source determines Delivery Artifact behavior, optional Slice Artifact behavior, Slice completion validation, Review Surface behavior, Feedback retrieval behavior, Ship behavior, and Abandon cleanup behavior.
_Avoid_: Project Config, source config, target type

**Project Source Type**:
The kind of Project Source a Project uses, such as source control. Core owns Project Source Type behavior; provider operations perform that behavior on Core's behalf without deciding workflow semantics.
_Avoid_: Project kind, target type

**Project Config**:
Project-level orchestration settings that apply to Plans and Deliveries in a Project unless overridden at a narrower scope. Project Config does not change the Project Source.
_Avoid_: scheduler settings

**Source Control Project**:
A Project whose Project Source is source control. In v1, Source Control Projects manage one or more GitHub Repositories.
_Avoid_: Repository Project, Git project, repo project

**Source Control Provider**:
A Core-owned provider implementation for Source Control Project external operations, such as GitHub. A Repository uses one supported Source Control Provider, and that provider satisfies Core's Source Control Provider contract while Core owns Source Control Project workflow semantics.
_Avoid_: Source Control Port, Project Source Type, consumer integration logic

**Repository**:
A Source Control Project-managed source control target. For Source Control Projects, a Delivery targets exactly one Repository, while Plans may coordinate work across multiple Repositories in the same Project. Repository provider config identifies the target and the Secret Core uses for provider access. Repository config writes validate the referenced Secret exists in the Portfolio without calling GitHub; external access validation happens in preflight or provider operations.
_Avoid_: Project, repo

**Repository Preflight**:
An observational validation operation that checks whether a stored Repository is ready for Source Control Provider access. Repository Preflight returns Validation Evidence and does not record lifecycle facts. Expected readiness failures, including missing or inactive provider access Secrets and provider access failures, are reported as failed Validation Evidence; missing target Repository records, storage failures, and invalid Core Service Outputs remain operation errors.
_Avoid_: Repository status, Repository health state, access lifecycle event

**Plan**:
A Project-level reusable planning and discovery artifact. A Plan belongs to exactly one Project, captures research, analysis, requirements, and architectural discussion, and may produce zero, one, or many Plan Outputs for its Project.
_Avoid_: Grill

**Plan Config**:
Immutable Plan-level orchestration settings for Planning, set only when the Plan is created. Plan Config does not control accepted Delivery execution.
_Avoid_: Delivery Config, Project Config

**Planning**:
The activity of exploring a problem and refining a Plan.
_Avoid_: Grilling

**Planner**:
The human steering Planning toward an acceptable Plan Output.
_Avoid_: Agent, intelligence, Plan owner

**Plan Output**:
The structured proposal shape a planning Agent Run must produce for review as a whole. A Plan Output proposes new Deliveries with their initial Slices, plus Memories and Links. Proposed Deliveries may depend on existing Deliveries or other proposed Deliveries in the same Plan Output. Accepting a Plan Output materializes those proposed artifacts into the Portfolio graph, including Instruction Sources stored on the materialized Slices, and records Plan-produced Memory provenance for materialized Memories. Rejecting it materializes none of them. Plan Outputs do not add Slices to existing Deliveries, must propose at least one initial Slice for each proposed Delivery, and are not stored Portfolio artifacts.
_Avoid_: Accepted Plan, partial acceptance, staged output set, draft Plan

**Delivery**:
The Project-level unit of accepted executable work materialized by accepting a Plan Output. A Delivery belongs to a Project for execution, participates in the Portfolio graph for planning, provenance, and same-Project Delivery-level dependencies, targets exactly one execution target for its Project Source Type, and owns authoritative lifecycle fields for queueing and closure.
_Avoid_: Change, task, ticket, draft Plan

**Queued Delivery**:
A Delivery whose queued lifecycle field is set, so its work may run once Delivery Work State gates allow it. Queueing a Delivery records user intent for work to begin when dependencies, readiness checks, and scheduler limits permit.
_Avoid_: Started Delivery, running Delivery, active Delivery, Execution

**Shipped Delivery**:
A Delivery whose closed lifecycle field records a shipped outcome after its external integration lifecycle has been completed.
_Avoid_: Released Delivery, landed Delivery

**Abandon**:
To close a Delivery without shipping it, after required Project Source Type-specific cleanup is attempted or recorded.
_Avoid_: Archive, delete, cancel, soft-delete

**Abandoned Delivery**:
A Delivery whose closed lifecycle field records an abandoned outcome, removed from active execution consideration without being Shipped. Abandoning a queued Delivery must close or abandon active external work where possible. For dependency calculation, an Abandoned Delivery satisfies Delivery-level dependencies as if it were Shipped.
_Avoid_: Archived Delivery, Deleted Delivery, canceled Delivery, soft-deleted Delivery

**Slice**:
An independently executable unit inside exactly one Delivery. A Slice's parent Delivery, immutable Delivery-scoped order, and initial Instruction Source are immutable after acceptance. Slice order records the accepted Plan Output order for Slices within the Delivery and is the source of truth for deterministic same-Delivery Slice ordering. Slices participate in the Portfolio graph, and Slice-level dependencies are represented by Links between Slices in the same Delivery.
_Avoid_: Step, task, subtask

**Slice Work State**:
A derived state describing whether Slice work can run or what external state it is waiting on. Slice Work State is computed from same-Delivery Slice dependency Links, Actions, completed Agent Runs, Slice Artifacts, and Review Surfaces, not stored directly. A Slice may be complete, needs-delivery-validation, dependency-blocked, needs-artifact-validation, correction-blocked, awaiting-review, slice-operation-failed, needs-artifact-creation, or executable, derived in that priority order. Complete means the Slice Artifact has been promoted into the Delivery Artifact and a later Slice Delivery Artifact validation passed. Needs-delivery-validation means the Slice Artifact has been promoted into the Delivery Artifact and the resulting Delivery Artifact still needs Slice Delivery Artifact validation. Needs-artifact-validation means completed Slice execution must be validated by Gorchestra before review or promotion. Incomplete Agent Runs are transient runtime/adoption facts and do not create a public Slice Work State in v1. Correction-blocked means automatic correction retry budget is exhausted for a Failure Chain; its action points to the latest failed Action that exhausted retries. Slice-operation-failed means the latest Slice-scoped external operation failed before correction could run; explicit manual retry/recovery operation will be added later. Needs-artifact-creation means the Slice is otherwise initially executable, but its Slice Artifact has not been created yet. maxProcessableSliceSlots limits concurrent in-call Slice operations rather than all in-flight Slice workflows. A Slice operation occupies a slot while the current runDeliveryWork call is actively processing it. Slice Artifact creation, Agent Run execution through runner completion, Slice Artifact validation, and Slice Delivery Artifact validation are slot-occupying operations while they are being processed. runDeliveryWork may continue claiming new Slice operations as slots open until no actionable Slice work remains. Executable Slices are candidates for runDeliveryWork to claim one processing slot at a time and may be initial or correction work; correction work carries its Failure Chain. Dependency-blocked contains direct incomplete same-Delivery Slice dependencies ordered by dependency acceptance time, then Slice ID.
_Avoid_: Slice status, task state, stored Slice state

**Failure Chain**:
A derived sequence of Slice correction work rooted at the failed validation or external-operation Action that first produces correction evidence for that sequence. A Failure Chain starts when a failed Action makes a Slice executable in correction mode. Failure Chain is not stored on Actions; correction Slice Work States derive and carry their current Failure Chain. Correction retries belong to that root Failure Chain until a later validation/promotion path succeeds or retry budget is exhausted.
_Avoid_: retry group, attempt series, error thread

**Instruction Source**:
Immutable stored instructions used by Agent Runs to perform accepted Slice or Revision work.
_Avoid_: Plan Output, Revision Output, prompt

**Delivery Config**:
Scoped configuration for a Delivery's work. Delivery Config covers all configurable Delivery work behavior, including scheduler-processable Slice work slots, correction retry limits per failure chain, Model selection for Actions, and Model timeout. Model timeout applies only to Model Agent work; future Agent types get their own config fields. Delivery Config may be configured at Portfolio, Project, or Delivery scope and inherited by a Delivery. Delivery Config is resolved on demand when work needs it, so changing a Delivery's config affects future work. Invalid Delivery Config is rejected when set. An unresolved Delivery Work Config is a failed Delivery preflight condition, not an unimplemented work state.
_Avoid_: Execution Config, Execution Policy, scheduler settings

**Delivery Work State**:
A derived state describing the current execution state of a Delivery. Delivery Work State is computed from Delivery lifecycle fields, dependency Links, dependency Delivery outcomes, Slices, Actions, and Review Surfaces, not stored directly. Closed and unqueued states come from the Delivery's authoritative lifecycle fields. A Delivery may be closed, unqueued, dependency-blocked, preflight-failed, needs-artifact-creation, slices-incomplete, delivery-operation-failed, delivery-validation-failed, delivery-review-failed, needs-artifact-validation, needs-review-surface, awaiting-review, or ready-to-ship, derived in that priority order. Needs-artifact-creation means the Delivery is queued and unblocked, but its Delivery Artifact has not been created yet. Slices-incomplete means at least one Slice is not complete; detailed per-Slice state comes from Slice Work State. Delivery-operation-failed means the latest Delivery-scoped external operation failed; explicit manual retry/recovery operation will be added later. Delivery-validation-failed means the latest Delivery-level artifact validation failed; exact Delivery-level correction behavior is deferred. Delivery-review-failed means the current Delivery Review Surface closed without merge; exact Delivery-level correction behavior is deferred. Needs-artifact-validation means all Slices are complete and the Delivery Artifact needs Delivery-level validation before review/ship flow can continue. Needs-review-surface means Delivery Artifact validation passed and a Delivery Review Surface still needs to be created. Before creating a Delivery Review Surface, Gorchestra checks whether the Delivery Artifact is already integrated into the target; if so, it records observed Delivery Artifact integration and the Delivery becomes ready-to-ship without a new Review Surface. Awaiting-review means the Delivery Review Surface exists and is waiting for external review, merge, or observation; replaced Review Surfaces keep the Delivery awaiting-review with the current replacement Review Surface. Ready-to-ship means the Delivery Artifact is integrated into the target and shipDelivery may be called; v1 does not run post-merge Ship validation. Dependency-blocked means direct same-Project Delivery dependencies are not yet closed; blocked dependencies are ordered by dependency acceptance time, then Delivery ID. Preflight-failed means the latest Delivery preflight Action failed and work cannot continue until explicit preflight retry records a later passing Delivery preflight Action.
_Avoid_: Execution state, job state, stored work state

**Delivery Context**:
A transient, never-stored context Gorchestra prepares around one Delivery from stored Portfolio facts. Delivery Context contains scoped, validated Portfolio facts needed to derive Delivery and Slice Work States for that Delivery, including the Delivery Artifact when present, each Slice with its Slice Artifact and direct Slice dependency links, direct Delivery dependency summaries, and Delivery Actions sorted by performed time. Delivery Context does not include resolved Delivery Config, selected Models, selected Model Providers, or plaintext provider access.
_Avoid_: Runtime Delivery Work Context, scheduler context, stored execution context, Agent Run context, facts bag

**Delivery Work Resolution**:
A transient, never-stored resolution of the Delivery Config and selected execution Model identity needed for one scheduler-actionable Delivery work pass. Delivery Work Resolution does not contain plaintext provider access; provider families resolve provider access on demand for the specific preflight or external operation that needs it.
_Avoid_: Runtime Delivery Work Context, scheduler context, execution context

**Agent**:
The discriminated value recorded on an Agent Run that identifies what performed the work. In v1, the only Agent is Model Agent. Agent is not a stored core model.
_Avoid_: actor, stored Agent, worker, executor

**Agent Type**:
The kind of Agent recorded on an Agent Run. Agent Type describes how the work is performed, not why a particular run exists. In v1, Model Agent is the only supported Agent Type.
_Avoid_: Mission type, purpose, interaction mode

**Model Provider**:
A Portfolio-owned configured source of selectable language Models. A Model Provider has an explicit endpoint, immutable Model Provider Protocol, optional standard auth backed by Secrets, and a list of custom headers backed by Secrets that defaults to empty. Core owns Model Provider Protocol behavior so Model Agent execution is consistent across consumers. Editable Model Provider fields record when they were last updated. Model Providers may be archived, which makes their Models unavailable for new work while retaining them for historical references; this availability is derived rather than cascaded to child Models. Archived Model Providers may be updated before being unarchived.
_Avoid_: model source, LLM provider, consumer model adapter

**Model Provider Protocol**:
The stable wire/API protocol Gorchestra uses to call a Model Provider. A Model Provider Protocol is a Core-owned provider behavior contract, not consumer-defined integration logic.
_Avoid_: provider brand, model type, API key type

**Model**:
A named Portfolio-owned selectable language model under a Model Provider. A Model has a human-readable name and an immutable provider-facing model identifier. Editable Model fields record when they were last updated. Models may be archived, which makes them unavailable for new work while retaining them for historical references. Archived Models may be updated before being unarchived.
_Avoid_: provider/model string, model slug

**Model Preflight**:
An observational validation operation that checks whether a stored Model is ready for Model Provider Protocol access. Model Preflight returns Validation Evidence and does not record lifecycle facts. Expected readiness failures, including archived Models or Model Providers, missing, inactive, or unresolved provider access Secrets, and provider access or model availability failures, are reported as failed Validation Evidence; missing target Model records, missing referenced Model Provider records, storage failures, and invalid Core Service Outputs remain operation errors. Provider setup guidance lives in `provider-setup.md`.
_Avoid_: Model status, Model health state, access lifecycle event

**Model Agent**:
An Agent Type where Gorchestra's Core-owned agent loop uses a configured Model to perform goal-directed work consistently across consumers.
_Avoid_: LLM Loop Agent, Pi Agent, Codex Agent, external harness, consumer agent adapter

**Agent Run**:
One concrete session where an agent carries out goal-directed work for Gorchestra. An Agent Run records its agent as a discriminated value and records its purpose with the domain target it works on, such as a Slice execution purpose with Delivery, Slice, and an execution mode union. Initial Slice execution has no correction root; correction Slice execution records the Failure Chain root it is correcting. Agent Runs may gather information, use tools, edit code, run tests, produce outputs, or request human decisions. Core owns Agent Run behavior; an Agent Run does not own authoritative Delivery or Slice Work State.
_Avoid_: Mission, Turn, AgentAttempt, actor

**Agent Run Sandbox**:
The isolated environment an Agent Run uses for its work, such as a worktree, temporary files, tools, and runtime environment. Core owns Agent Run orchestration semantics, while consumers provide deployment-specific sandbox primitives such as allocation, execution isolation, resource limits, and cleanup. An Agent Run Sandbox is isolated to one Agent Run; cross-run state must be promoted by Gorchestra evaluation.
_Avoid_: Mission Sandbox, Execution Sandbox, shared sandbox, workspace, project checkout

**Delivery Artifact**:
The Project Source Type-specific authoritative in-progress artifact for a Delivery, created lazily by Gorchestra runtime work when execution first begins, promoted by Gorchestra from an Agent Run Sandbox after evaluation, and available to later Agent Runs or Project Source Type-specific external mutations. Every Project Source Type defines its Delivery Artifact. For a Source Control Project Delivery, the Delivery Artifact is the Delivery Branch.
_Avoid_: Working Artifact, Working State, Agent Run Sandbox artifact, workspace, branch state

**Slice Artifact**:
A Project Source Type-specific temporary artifact for one Slice, created lazily by Gorchestra runtime work when that Slice first begins. Project Source Types may define Slice Artifacts when they support isolated or parallel Slice work. A Slice with a Slice Artifact is complete only after the Slice Artifact is promoted into the Delivery Artifact and the resulting Delivery Artifact passes Slice Delivery Artifact validation. For a Source Control Project Slice, the Slice Artifact is the Slice Branch.
_Avoid_: Working Artifact, Agent Run Sandbox artifact, Delivery Artifact

**Delivery Branch**:
The Source Control Project representation of a Delivery Artifact. A Source Control Project Delivery has exactly one Delivery Branch, created from the Delivery's Target Branch when execution first begins and merged back into the Target Branch when the Delivery ships. Gorchestra assigns the Delivery Branch from the Delivery identity so branch creation can be retried safely.
_Avoid_: Delivery Artifact, Agent Run Sandbox, Slice Branch

**Target Branch**:
The immutable source control branch a Source Control Project Delivery targets. The Delivery Branch is created from the Target Branch when execution first begins and merged back into the Target Branch when the Delivery ships. A Plan Output must specify a Target Branch for each Source Control Project Delivery.
_Avoid_: Base Ref, base branch, starting branch

**Slice Branch**:
The Source Control Project representation of a Slice Artifact. Slice Branch work is merged into the Delivery Branch before the Slice is complete. Gorchestra assigns the Slice Branch from the parent Delivery identity and Slice identity so branch creation can be retried safely.
_Avoid_: Slice Artifact, Delivery Branch, Agent Run Sandbox

**Action**:
An authoritative Delivery execution fact. An Action records evaluated Agent Run work, validation, external operation results, preflight results, artifact promotion, review-surface observations, or other execution facts that are not Delivery lifecycle field mutations. Queueing, shipping, and abandonment are recorded on Delivery lifecycle fields rather than as Actions. Action authorization is non-null only when the Action is the authoritative fact created by an explicit consumer-authorized operation. If a consumer-authorized operation writes a domain lifecycle field instead, that domain-named Audit Stamp carries the authorization and scheduler/runtime Actions use null authorization. Evidence attached to Actions is safe/redacted before storage or reuse, including when provided as input to a later Agent Run.
_Avoid_: Job, Execution, lifecycle status

**Decision**:
A request for human judgment raised during Planning or Delivery execution. A Decision captures a point where Gorchestra needs human input before work can continue, such as exhausted correction retries. Decision is glossary-level in current v1 docs; exact model/API behavior is deferred.
_Avoid_: Confirmation, approval, prompt

**Portfolio Memory**:
The Portfolio's second brain: the collection of Memories preserved across planning and execution. Project Memory is a view of Portfolio Memories relevant to a Project.
_Avoid_: Workspace Memory, Wiki, knowledge base

**Memory**:
An immutable Portfolio-owned context artifact. Memories may capture decisions, facts, constraints, assumptions, risks, architecture, workflows, or conventions; newer Memories may supersede older ones.
_Avoid_: Wiki, note, record, knowledge record

**Current Memory**:
A Memory that has not been superseded by another Memory.
_Avoid_: Active Memory, latest Memory

**Link**:
A typed directed relationship between graph nodes such as Plans, Projects, Deliveries, Slices, and Memories. Portfolio is the graph boundary, not a graph node. Links connect graph nodes, not other Links. Links between Project-level nodes stay within one Project; Portfolio Memories may link to nodes in any Project. A Link reads as “from node, link-type verb, to node”; for example, a depends-on Link means the `from` node depends on the `to` node. Common Link types include produced, references, supersedes, supports, contradicts, and depends-on.
_Avoid_: Relationship, edge, reference, edge-as-node

**Preflight**:
A readiness validation performed before Gorchestra begins or resumes work. Top-level Core preflight is an opened-Core API that checks required deployment mechanics: storage, Secrets, Agent Run Sandbox, Clock, and ID generation. It returns a transient readiness report for consumers and does not check optional logger/event publishing or provider-specific readiness. Delivery preflight runs before each bounded scheduler-actionable pass, after cheap closed, unqueued, dependency-blocked, and preflight-failed gates, and produces Delivery Work Resolution as transient scheduler data. Provider-backed Delivery preflight checks the Delivery target Repository and the selected execution Model before Delivery work runs or resumes. Successful Delivery preflight is normally not stored, except when explicit retry supersedes the latest failed Delivery preflight Action; failed Delivery preflight is recorded as a validate-preflight Action whose component checks determine whether the preflight passed. Explicit Delivery preflight retry records both passing and expected failed readiness outcomes as Delivery preflight Actions; setup-incomplete readiness, such as missing Portfolio Config, is preflight evidence, while storage failures, invalid Core Service Outputs, and missing referenced Portfolio facts that should exist remain operation errors rather than preflight evidence. A runDeliveryWork pass records scheduler work from the Delivery Context and Delivery Work Resolution it read at the start of the pass; later changes apply to later passes, and the scheduler or consumer runtime must ensure only one worker processes a Delivery at a time. A Delivery whose latest Delivery preflight Action failed is preflight-failed until an explicit retry records a later passing Delivery preflight Action. Other preflight results, such as explicit Repository preflight, may be returned to consumers as safe validation evidence without storing Actions or authoritative Portfolio facts. Preflight may check Project, Repository, Model Provider, Model, Secret Binding, or execution target readiness.
_Avoid_: Doctor, health check

**Timeline**:
A Portfolio-level derived list of events that affect Portfolio state, computed from Gorchestra facts. Project, Delivery, and Slice timelines are filtered views of the Portfolio Timeline.
_Avoid_: Timeline Event records, log, activity feed

**Ship**:
To close a Delivery's external integration lifecycle after all of its Slices are complete and its Delivery Artifact is integrated into the target. For a Source Control Project, a Delivery is Shipped when its Delivery Branch is integrated into the Target Branch, whether Gorchestra observes a merged Delivery Review Surface or observes that the Target Branch already contains the Delivery Branch. V1 does not run post-merge Ship validation; post-merge validation is a future feature candidate.
_Avoid_: Release, submit, land

**Review Surface**:
The place where Delivery or Slice work is presented for human or external review. Review Surface history is preserved when a Review Surface is replaced. For Source Control Projects, a Review Surface is a pull request.
_Avoid_: Pull request, review target, submission

**Slice Review Surface**:
A Review Surface for a Slice Artifact. For Source Control Projects, this is a pull request from the Slice Branch into the Delivery Branch. The current Slice Review Surface for ongoing review is derived from Review Surface history.
_Avoid_: Slice PR, review target

**Delivery Review Surface**:
A Review Surface for a Delivery Artifact. For Source Control Projects, this is a pull request from the Delivery Branch into the Target Branch. The current Delivery Review Surface for ongoing review is derived from Review Surface history.
_Avoid_: Delivery PR, review target

**Revision Gate**:
Human-controlled artifact-scoped authorization that allows Gorchestra to plan revision work in response to fetched Feedback for a Slice Artifact or Delivery Artifact. Opening a Revision Gate starts a revision planning session that may produce Revision Outputs until one is accepted or the gate is closed. Revision Gate does not create or reopen Slices.
_Avoid_: revisionAllowed, needs-revision, changes-requested, per-comment approval

**Revision Output**:
The structured proposal shape a revision-planning Agent Run must produce for review as a whole. A Revision Output proposes revision work against a Delivery Artifact or Slice Artifact and accounts for fetched Feedback with a Revision Disposition. Accepting a Revision Output creates a Revision. Rejecting it creates no Revision. Revision Outputs do not create or reopen Slices and are not stored Portfolio artifacts.
_Avoid_: revision Slice, feedback Slice, partial acceptance, Plan Output

**Revision**:
A unit of accepted revision work against a Slice Artifact or Delivery Artifact, created by accepting a Revision Output. A Revision stores the immutable Instruction Source and immutable Revision Disposition for the Agent Runs that perform the revision.
_Avoid_: Slice, Delivery, Revision Output

**Revision Disposition**:
The immutable human-readable account of how a Revision responds to fetched Feedback.
_Avoid_: Feedback, Feedback Disposition, stored comment, review response

**Feedback**:
Review input fetched from a Review Surface. Feedback does not authorize revision work unless the Revision Gate is open.
_Avoid_: Review signal, stored comment

## Relationships

- A **Consumer** passes **Core Inputs** to core after authorizing an operation.
- **Invalid Core Input** is rejected before the operation can create or mutate Portfolio facts.
- **Core Services** provide deployment mechanics to Core; any returned value is a **Core Service Output** and is validated before Core trusts it.
- An archivable record stores **Archive Periods**; its current archived state is derived from the latest period.

## Example dialogue

> **Dev:** "Should the Core Orchestration API expose `listSecrets` so the UI can show a settings page?"
> **Domain expert:** "No — that is a non-orchestration view, so the Consumer can use its storage projection. Core commands still create, replace, archive, and bind **Secrets** because those mutations affect Core invariants."
>
> **Dev:** "When a **Model** is archived and later unarchived, do we clear an archived field?"
> **Domain expert:** "No — we close the latest **Archive Period** so the current state and the transition history are both preserved."

## Flagged ambiguities

- "input passed to core" was narrowed to **Core Input** at the public Consumer-to-core API boundary; values returned by Core Services are **Core Service Outputs** with their own validation boundary.
- Archival was narrowed from nullable `archived` stamps to **Archive Period** history so unarchive transitions are preserved instead of erased.
- Core operation results were narrowed from catch-all **CoreError** returns to **Operation Error Unions** so each public operation advertises only the error variants it can return.
