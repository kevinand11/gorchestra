# Gorchestra Core

The Gorchestra core is the reusable Portfolio-level orchestration context. It manages Portfolio data, planning, graph relationships, delivery execution, portable Portfolio Snapshots, and Project-level work without depending on server-app tenancy concepts.

## Language

**Portfolio**:
A core orchestration boundary that groups Projects and shared reusable context or resources such as Memories and Secrets.
_Avoid_: Project Space, program, workspace

**Portfolio Graph**:
The Portfolio-scoped graph of Core graph nodes and Links. Plans, Deliveries, Slices, Memories, and Memory Revisions can be nodes whether or not they currently have Links. Projects provide graph address context for Project-scoped nodes, and the Portfolio itself is the graph boundary; neither Project nor Portfolio is a graph node in v1.
_Avoid_: Brain Graph, Workspace Graph, relationship map

**Graph Node Ref**:
A validated self-contained address for one node in the Portfolio Graph. A Graph Node Ref identifies the node and, for nested graph nodes, includes the owning domain context needed to interpret and validate the address: Plans and Deliveries carry Project context, Slices carry Delivery and Project context, and Memory Revisions carry Memory context. Memory parentage is Memory structure rather than graph address context, so Memory Graph Node Refs do not carry parent context. A Graph Node Ref is valid only when its included context matches the referenced Portfolio facts.
_Avoid_: loose id pointer, graph node payload, denormalized node copy

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
A value a Consumer passes through a public core API boundary, including command inputs, query arguments, Snapshot operation inputs, Command Context values, Work Context values, and Open Core options.
_Avoid_: payload, request body, port result

**Core Id**:
A Core-owned ULID-format storage identity for Core records. Core-generated Core Ids are sortable and lexicographically creation-ordered, so Core list queries use ids as their canonical order and optional boundary.
_Avoid_: opaque id, random id, display id

**Core Orchestration API**:
The public Core command/query surface for operations that read or mutate Core-owned Portfolio state. Consumers use Core queries for standalone reads of Core-owned Portfolio state, and mutations that affect Core invariants or lifecycle facts go through Core commands.
_Avoid_: UI API, admin API, storage API

**Paginated Query Envelope**:
The standard Core list-query result boundary that wraps an ordered page or full ordered set of optionally id-bounded items with page navigation and count metadata. A Paginated Query Envelope is an id-bounded list result, not a separate cursor feed or a bare list array.
_Avoid_: bare list response, cursor feed, infinite-scroll event stream

**Command Context**:
A Core command boundary value supplied by a Consumer for consumer-authorized Core commands. A Command Context contains the Local Actor Ref and optional opaque correlation id Core uses when it records Audit Stamps for user-authorized operations.
_Avoid_: Operation Context, request context

**Work Context**:
A Core Work Operation boundary value supplied by a Consumer runtime when invoking runtime-owned Core Work Operations. Work Context is not user authorization and does not create Audit Stamps for runtime-generated facts.
_Avoid_: Runtime Context, Runtime Command Context, Operation Context, user context

**Core Work Operation**:
A runtime-invoked Core write operation that advances already-recorded Core work without representing a consumer-authorized user command. Core Work Operations are invoked by Consumer runtime components such as dispatchers or delivery processors.
_Avoid_: Command, query, scheduler job

**Core Service**:
A consumer-provided deployment boundary used by Core for deployment mechanics such as storage, Secret-at-rest protection and plaintext resolution, consumer-managed sandbox execution, logging, or event publishing. Core Services do not own Portfolio orchestration, Source Control Provider, Model Provider Protocol, Core-owned Sandbox Provider behavior, Agent Run behavior, portable Snapshot encryption, lifecycle time semantics, or Core identifier generation.
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
A Portfolio-owned sensitive value with a non-unique user-facing name and a stored protected value reference but never plaintext. Users may create, replace, and archive Secret values, and Core may return Secret records from write operations, but users may not view plaintext values after creation; v1 Secrets do not have provider-specific Secret types.
_Avoid_: Credential, token, key, sensitive value

**Active Secret**:
A Secret whose latest Archive Period is absent or unarchived, so Core may use its Protected Secret Value Reference for configured provider access, Agent Run runtime requirements, or sandbox credentials. An inactive Secret is archived and cannot be used without first being unarchived.
_Avoid_: enabled Secret, live credential, archived Secret reference

**Protected Secret Value Reference**:
A consumer-specific protected token that lets the owning Consumer resolve Secret plaintext without Core storing plaintext. It may be an external protected-store reference or an inline encrypted value envelope.
_Avoid_: Plaintext secret, decrypted secret value

**Secret Reference**:
A direct Core-owned Portfolio usage of a Secret by a stored data model that may use that Secret for future provider access, Agent Run environment exposure, command-scoped Agent Run preparation access, or Core-owned sandbox runtime credentials. Secret References report whether the referring data model is active and never expose plaintext.
_Avoid_: Secret Link, credential usage, historical secret mention, Secret Binding

**Environment Variable**:
A Secret exposed to Agent Runs as a named runtime environment variable through an Agent Run Environment Secret Requirement. V1 Environment Variable names use uppercase POSIX-style names with letters, digits, and underscores, and must not start with a digit.
_Avoid_: Environment, environment secret, Secret Binding

**Agent Run Environment Secret Requirement**:
An Agent Run Runtime Requirement that assigns one environment variable name to one Secret for an Agent Run Profile Snapshot or an additive Agent Run Runtime Requirement Override. Repeated environment variable names are applied in order with last-write-wins semantics, while exact duplicate environment Secret assignments are rejected as redundant. Core stores the environment variable name and Secret id, validates referenced Secrets when requirements are configured, and re-checks active Secret resolution during Agent Run Preparation; plaintext Secret values resolve only transiently through Consumer-provided Secret services.
_Avoid_: Secret Binding, Secret Assignment, credential assignment, plaintext environment value

**GitHub PAT**:
A personal access token value a user may store as a Secret for GitHub Repository access. GitHub PAT is not a separate Secret type in v1.
_Avoid_: GitHub token, GitHub credential

**Portfolio Snapshot**:
A Core-encrypted portable artifact containing portable Portfolio facts. Portfolio Snapshots always include Secrets and can be restored by any Gorchestra consumer with the passphrase, but do not make live Agent Run Sandbox contents portable or guarantee that restored in-progress sandbox keys still resolve in a Consumer deployment.
_Avoid_: Backup, dump, workspace export, sandbox snapshot

**Export**:
The operation that creates a passphrase-encrypted Portfolio Snapshot from the currently-open Portfolio using Core-owned snapshot encryption behavior.
_Avoid_: Backup, dump

**Restore**:
The operation that replaces the currently-open Portfolio contents with a Core-encrypted Portfolio Snapshot using its passphrase.
_Avoid_: Import, upload, merge

**Project**:
An orchestration boundary inside a Portfolio where Gorchestra executes Deliveries against one or more execution targets. A Project has a non-unique user-facing title; Project identity comes from its id. Project-specific planning context is expressed through Project-level Plans and Links to Portfolio-owned Memories.
_Avoid_: Repository, repo

**Project Source**:
The immutable configured execution source a Project manages. A Project Source determines Delivery Artifact behavior, optional Slice Artifact behavior, Slice completion validation, Review Surface behavior, Feedback retrieval behavior, Ship behavior, and Abandon cleanup behavior.
_Avoid_: Project Config, source config, target type

**Project Source Type**:
The kind of Project Source a Project uses, such as source control. Core owns Project Source Type behavior; provider operations perform that behavior on Core's behalf without deciding workflow semantics.
_Avoid_: Project kind, target type

**Model Use Config**:
An atomic configuration value that selects a Model and Model Thinking Level together for an Agent Run. Model Use Config appears inside Agent Run Profiles and Agent Run Model Use Overrides so Core never represents a half-selected or incompatible model/thinking pair.
_Avoid_: model id config, thinking override, partial model selection

**Model Reference**:
A direct Core-owned Portfolio usage of a Model by a stored reusable configuration model, such as an Agent Run Profile, that may select that Model for future Agent Runs. Model References report whether the referring data model is active and do not expand Agent Run Profile Snapshots, Agent Run Model Use Overrides, inherited/effective selections, or historical transcript usage.
_Avoid_: Model Binding, model usage link, selected model pointer, inherited model usage, Agent Run transcript selection

**Project Config**:
Required Project-level source-agnostic orchestration settings shared across Project Source Types. In v1, Project Config supplies the Project's default Delivery Work Config; it does not change the Project Source or carry source-control-specific setup.
_Avoid_: scheduler settings, source config, project type config

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
An observational validation operation that checks whether Core can currently resolve and use a stored Repository's Source Control Provider configuration. Repository Preflight returns transient Validation Evidence and does not record lifecycle facts, readiness state, or history. Expected validation failures, including missing or inactive provider access Secrets and provider access failures, are reported as failed Validation Evidence; missing target Repository records, storage failures, and invalid Core Service Outputs remain operation errors.
_Avoid_: Repository status, Repository health state, Repository readiness, access lifecycle event

**Plan**:
A Project-level reusable planning and discovery artifact. A Plan belongs to exactly one Project, captures research, analysis, requirements, and architectural discussion, starts exactly one Planning Agent Run with a selected Agent Run Profile when created, and may produce zero, one, or many Plan Outputs for its Project. Closing a Plan records consumer-authorized intent to stop further Planning input and model turns without deleting the Plan or invalidating pending Plan Output review.
_Avoid_: Grill

**Planning**:
The read-only activity of exploring a problem and refining a Plan, plus creating, reviewing, and materializing Plan Output proposals. Planning does not implement Delivery or Slice work; implementation happens later through accepted Delivery execution.
_Avoid_: Grilling, implementation

**Planner**:
The human steering Planning toward an acceptable Plan Output.
_Avoid_: Agent, intelligence, Plan owner

**Plan Output**:
The structured proposal shape a planning Agent Run may produce for human review as one acceptable chunk. A Plan may have multiple Plan Outputs over time, each Plan Output is independently reviewable and materializable, and separate Plan Outputs may propose different acceptable chunks such as durable Memory changes first and executable Deliveries later. Each Plan Output proposes new Deliveries with their initial Slices, new Memories with initial Memory Revisions, and new Memory Revisions for existing Memories. Proposed Deliveries may depend on existing Deliveries or other proposed Deliveries in the same Plan Output. Accepting a Plan Output materializes those proposed artifacts into the Portfolio graph, including Instruction Sources stored on the materialized Slices, produced Links from the Plan to newly materialized Memories, produced Links from the Plan to every materialized Memory Revision, and depends-on Links for proposed Delivery or Slice dependencies. Rejecting it materializes none of them. Plan Outputs do not add Slices to existing Deliveries, must propose at least one initial Slice for each proposed Delivery, do not propose arbitrary Core Links, and are not stored Portfolio artifacts.
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
An executable and reviewable unit inside exactly one Delivery. A Slice's parent Delivery, immutable Delivery-scoped order, and initial Instruction Source are immutable after acceptance. Slice order records the accepted Plan Output order for semantic same-Delivery sequencing, while public list/read-model arrays still use Core's canonical id-desc list order. Slices participate in the Portfolio graph, and Slice-level dependencies are represented by Links between Slices in the same Delivery.
_Avoid_: Step, task, subtask

**Slice Work State**:
A derived state describing whether Slice work can run or what external state it is waiting on. Slice Work State is computed from same-Delivery Slice dependency Links, Actions, completed Agent Runs, Slice Artifacts, and Review Surfaces, not stored directly. A Slice may be complete, operation-running, operation-queued, needs-delivery-validation, dependency-blocked, needs-artifact-validation, correction-blocked, needs-review-surface, awaiting-review, slice-operation-failed, needs-artifact-creation, or executable, derived in that priority order. Complete means the Slice Artifact has been promoted into the Delivery Artifact and a later Slice Delivery Artifact validation passed. Needs-delivery-validation means the Slice Artifact has been promoted into the Delivery Artifact and the resulting Delivery Artifact still needs Slice Delivery Artifact validation. Needs-artifact-validation means completed Slice execution must be validated by Gorchestra before review or promotion. Needs-review-surface means Slice Artifact validation passed and a Slice Review Surface still needs to be created. Incomplete Agent Runs are transient runtime/adoption facts and do not create a public Slice Work State in v1. Correction-blocked means automatic correction retry budget is exhausted for a Failure Chain; its action points to the latest failed Action that exhausted retries. Slice-operation-failed means the latest Slice-scoped external operation failed before correction could run; explicit manual retry/recovery operation will be added later. Operation-running and operation-queued mean a Delivery Work Dispatch Action has started or queued a still-in-transit Slice operation. Needs-artifact-creation means the Slice is otherwise initially executable, but its Slice Artifact has not been created yet. maxProcessableSliceSlots limits concurrent Slice operation dispatches for a Delivery. Slice Artifact creation, Agent Run execution through runner completion, Slice Artifact validation, Review Surface creation, and Slice Delivery Artifact validation are slot-occupying Slice operations while they are being processed. Executable Slices are candidates for a Delivery Work Scheduler Pass to dispatch one Slice operation at a time and may be initial or correction work; correction work carries its Failure Chain. Dependency-blocked contains direct incomplete same-Delivery Slice dependencies ordered by dependency acceptance time, then Slice ID.
_Avoid_: Slice status, task state, stored Slice state

**Failure Chain**:
A derived sequence of Slice correction work rooted at the failed validation or external-operation Action that first produces correction evidence for that sequence. A Failure Chain starts when a failed Action makes a Slice executable in correction mode. Failure Chain is not stored on Actions; correction Slice Work States derive and carry their current Failure Chain. Correction retries belong to that root Failure Chain until a later validation/promotion path succeeds or retry budget is exhausted.
_Avoid_: retry group, attempt series, error thread

**Instruction Source**:
Immutable stored instructions used by Agent Runs to perform accepted Slice or Revision work.
_Avoid_: Plan Output, Revision Output, prompt

**Delivery Work Config**:
Source-agnostic settings for executable Delivery work, including scheduler-processable Slice work slots, correction retry limits per Failure Chain, and execution/revision-execution Agent Run Profile selection. A null revision-execution Agent Run Profile selection means revision execution uses the execution Agent Run Profile, not that revision execution is disabled.
_Avoid_: Execution Config, model config, agent run config, scheduler settings

**Delivery Config**:
Delivery-scoped configuration for future executable work on one Delivery. In v1, Delivery Config may provide a full Delivery Work Config override; it is not inherited per field and does not apply to revision planning.
_Avoid_: Execution Config, Execution Policy, scheduler settings

**Delivery Work State**:
A derived state describing the current execution state of a Delivery. Delivery Work State is computed from Delivery lifecycle fields, dependency Links, dependency Delivery outcomes, Slices, Actions, and Review Surfaces, not stored directly. Closed and unqueued states come from the Delivery's authoritative lifecycle fields. A Delivery may be closed, unqueued, operation-running, operation-queued, dependency-blocked, preflight-failed, needs-artifact-creation, slices-incomplete, delivery-operation-failed, delivery-validation-failed, delivery-review-failed, needs-artifact-validation, needs-review-surface, awaiting-review, or ready-to-ship, derived in that priority order. Operation-running and operation-queued mean a Delivery Work Dispatch Action has started or queued a still-in-transit Delivery-level operation. Needs-artifact-creation means the Delivery is queued and unblocked, but its Delivery Artifact has not been created yet. Slices-incomplete means at least one Slice is not complete; detailed per-Slice state comes from Slice Work State. Delivery-operation-failed means the latest Delivery-scoped external operation failed; explicit manual retry/recovery operation will be added later. Delivery-validation-failed means the latest Delivery-level artifact validation failed; exact Delivery-level correction behavior is deferred. Delivery-review-failed means the current Delivery Review Surface closed without merge; exact Delivery-level correction behavior is deferred. Needs-artifact-validation means all Slices are complete and the Delivery Artifact needs Delivery-level validation before review/ship flow can continue. Needs-review-surface means Delivery Artifact validation passed and a Delivery Review Surface still needs to be created. Before creating a Delivery Review Surface, Gorchestra checks whether the Delivery Artifact is already integrated into the target; if so, it records observed Delivery Artifact integration and the Delivery becomes ready-to-ship without a new Review Surface. Awaiting-review means the Delivery Review Surface exists and is waiting for external review, merge, or observation; replaced Review Surfaces keep the Delivery awaiting-review with the current replacement Review Surface. Ready-to-ship means the Delivery Artifact is integrated into the target and shipDelivery may be called; v1 does not run post-merge Ship validation. Dependency-blocked means direct same-Project Delivery dependencies are not yet closed; blocked dependencies are ordered by dependency acceptance time, then Delivery ID. Preflight-failed means the latest Delivery preflight Action failed and work cannot continue until explicit preflight retry records a later passing Delivery preflight Action.
_Avoid_: Execution state, job state, stored work state

**Delivery Context**:
A transient, never-stored context Gorchestra prepares around one Delivery from stored Portfolio facts. Delivery Context contains scoped, validated Portfolio facts needed to derive Delivery and Slice Work States for that Delivery, including the Delivery Artifact when present, each Slice with its Slice Artifact and direct Slice dependency links, direct Delivery dependency summaries, and Delivery Actions sorted by performed time. Delivery Context does not include resolved Delivery Work Config, selected Agent Run Profiles, selected Models, selected Model Providers, or plaintext provider access.
_Avoid_: Runtime Delivery Work Context, scheduler context, stored execution context, Agent Run context, facts bag

**Delivery Work Resolution**:
A transient, never-stored resolution of the effective Delivery Work Config and selected execution Agent Run Profile needed for one scheduler-actionable Delivery work pass. Delivery Work Resolution does not contain plaintext provider access; provider families resolve provider access on demand for the specific preflight or external operation that needs it.
_Avoid_: Runtime Delivery Work Context, scheduler context, execution context

**Delivery Work Scheduler Pass**:
A Core Work Operation that reads the current Delivery Context and Delivery Work Resolution, then requests concrete Delivery Work Operations for the currently actionable Delivery or Slice work. A Delivery Work Scheduler Pass is Delivery-scoped and may safely find no actionable work.
_Avoid_: Delivery worker, Delivery lease, background job, stored scheduler state

**Delivery Work Operation**:
A concrete dispatched Core Work Operation that processes one scheduler-actionable Delivery-level or Slice-level operation derived from Delivery Work State or Slice Work State. Delivery Work Operations re-read current state before external side effects; stale operations are successful no-ops rather than failures.
_Avoid_: scheduler pass, worker lease, stored job

**Process Delivery Work Operation**:
The Core Work Operation boundary that processes one dispatched Delivery Work Operation. It starts from the queued Delivery Work Dispatch Action, records that operation processing has started, re-derives current underlying work state while ignoring that operation attempt's own dispatch Actions, and either performs the still-current operation or records a stale no-op.
_Avoid_: scheduler pass, run delivery work, worker lease

**Delivery Work Dispatch Action**:
An Action that records a Delivery Work Operation has been queued for dispatch, started by the dispatcher, or finished as processed or stale. Delivery Work Dispatch Actions are v1 execution facts used to derive in-transit Delivery or Slice work and avoid duplicate scheduling; started dispatch Actions reference the queued dispatch Action they start, and finish dispatch Actions terminate one started operation attempt. They are not durable dispatch request records and do not include lease recovery in v1.
_Avoid_: dispatch request, worker lease, stored job

**Agent**:
The discriminated value recorded on an Agent Run that identifies what kind of agent performed the work. In v1, the only Agent is Model Agent. Agent is not a stored core model and does not itself store the selected Model for each model call.
_Avoid_: actor, stored Agent, worker, executor

**Agent Type**:
The kind of Agent recorded on an Agent Run. Agent Type describes how the work is performed, not why a particular run exists. In v1, Model Agent is the only supported Agent Type.
_Avoid_: Mission type, purpose, interaction mode

**Model Provider**:
A Portfolio-owned configured source of selectable language Models. A Model Provider has an immutable Model Provider Source, optional standard access backed by Secrets, a list of custom headers backed by Secrets that defaults to empty, and optional provider-local AI SDK provider options. Core owns Model Provider Protocol behavior and maps supported sources and protocols to AI SDK language models so Model Agent execution is consistent across consumers. Editable Model Provider fields record when they were last updated. Model Providers may be archived, which makes their Models unavailable for new work while retaining them for historical references; this availability is derived rather than cascaded to child Models. Archived Model Providers may be updated before being unarchived, but their Model Provider Source remains immutable.
_Avoid_: LLM provider, consumer model adapter, provider/protocol pair

**Model Provider Source**:
The immutable source identity Core uses to resolve a Model Provider into concrete AI SDK provider behavior. Built-in Model Provider Sources select Core-known provider adapters and default endpoints, such as OpenAI Responses, Anthropic, Google Generative AI, and Groq. Custom-hosted Model Provider Sources require an explicit base URL and declare the Model Provider Protocol they implement. A Model Provider Source determines the Model Provider Protocol for built-in sources and supplies the custom-hosted protocol declaration when Core cannot infer it.
_Avoid_: endpoint field, provider/protocol matrix, provider brand string

**Model Provider Protocol**:
The stable Core-owned wire/API protocol Gorchestra uses to call a Model Provider through AI SDK-backed Core adapters. V1 supported Model Provider Protocols are `openai-responses`, `openai-chat-completions`, `anthropic-messages`, and `google-generative-ai`; `openai-completions` is not supported. Built-in Model Provider Sources determine their protocol by construction, while custom-hosted sources declare the protocol they implement. Consumers do not provide Model Provider Protocol implementations.
_Avoid_: provider brand, model type, API key type

**Model**:
A named Portfolio-owned selectable language model under a Model Provider, with a provider-facing model identifier, optional model-local AI SDK provider options, and capability metadata such as supported inputs, context and output limits, positive thinking support, and pricing. A Model describes what the language model can do; Agent Run Profiles and Agent Run Model Use Overrides describe how Gorchestra uses it for Agent Runs. Model thinking capability stores only configured positive Model Thinking Levels (`minimal`, `low`, `medium`, `high`, `xhigh`); `none` is implicit and always selectable. Core validates configured positive thinking support against the Model Provider Protocol so provider-impossible levels do not become selectable. Models may be archived, which makes them unavailable for new work while retaining them for historical references. Archived Models may be updated before being unarchived.
_Avoid_: provider/model string, model slug, runtime model policy

**Model Preflight**:
An observational validation operation that checks whether a stored Model is ready for Model Provider Protocol access. Model Preflight returns Validation Evidence and does not record lifecycle facts or Agent Run Events. Expected readiness failures, including archived Models or Model Providers, missing, inactive, or unresolved provider access Secrets, unsupported configured thinking, provider authentication or authorization failures, model availability failures, provider rate limits, content filtering, provider unavailability, and generation failures are reported as failed Validation Evidence; missing target Model records, missing referenced Model Provider records, storage failures, and invalid Core Service Outputs remain operation errors. Model Preflight uses a tiny bounded no-tool AI SDK `streamText` generation probe because AI SDK does not expose a provider-agnostic model metadata existence check. Provider setup guidance lives in `provider-setup.md`.
_Avoid_: Model status, Model health state, access lifecycle event

**Model Thinking Level**:
A Core canonical level for requesting or explicitly disabling provider reasoning behavior during a Model Agent turn. `none` means the user or configuration explicitly requested disabled thinking for that Agent Run, while missing runtime thinking means Core sends no AI SDK reasoning option. `none` is best-effort because some providers may approximate disabled thinking. Positive Model Thinking Levels are `minimal`, `low`, `medium`, `high`, and `xhigh`; a selected positive level must be configured on the Model and supported by its Model Provider Protocol. Model Thinking Levels are recorded in Model Use Config values on Agent Run Profile Snapshots and Agent Run Model Use Overrides, and assistant-message events store the resolved generation model facts used for each finalized model output; advanced provider-specific provider options may still take precedence according to AI SDK provider behavior.
_Avoid_: reasoning effort, thinking budget, provider reasoning value

**Model Agent**:
An Agent Type where Gorchestra's Core-owned agent loop uses selected Models to perform goal-directed work consistently across consumers. Core uses AI SDK `streamText` for model-backed turns while preserving Core-owned tool contracts and transcript events. Model selection comes from the Agent Run Profile Snapshot unless the Agent Run has a Model Use Override.
_Avoid_: LLM Loop Agent, Pi Agent, Codex Agent, external harness, consumer agent adapter

**Agent Run Runtime Requirements**:
The ordered environment Secret and run-command requirements an Agent Run needs in its Agent Run Sandbox. Agent Run Runtime Requirements can come from Project Source Type and Agent Run Purpose contributions resolved at Model Agent Run creation, an Agent Run Profile Snapshot, and additive Agent Run Runtime Requirement Overrides; Core Agent Run runtime owns source/purpose requirement derivation, while providers execute or integrate but do not decide which source/purpose requirements exist. Source/purpose contributions compile to the same generic environment Secret and run-command requirement variants rather than source-type-specific requirement variants. Stored Agent Runs always have resolved source runtime requirements, with an empty array representing resolved-empty source requirements. Model Agent Run creation validates Secret references in source-derived requirements, folds source requirements into desired runtime requirements before profile requirements, skips duplicate profile requirements that duplicate resolved source/purpose requirements, and fails without storing the Agent Run when source requirement resolution or source Secret reference validation fails. Duplicate requirements emitted by source/purpose resolution are invariant violations. Source/purpose requirements are the authoritative source requirement snapshot for that Agent Run and later preparation attempts trust the Agent Run's stored desired runtime requirements. Project Source Type and Agent Run Purpose combinations are explicit; Model Agent Run creation resolves source requirements from trusted Core-owned source context records needed by the Project Source Type × Agent Run Purpose branch, does not perform general Core storage consistency auditing or external provider calls, treats missing records it must load as not-found operation errors, and treats unhandled combinations as invariant violations while a handled combination may intentionally resolve to an empty requirement list. Each requirement must succeed before the next requirement is applied.
_Avoid_: Sandbox Requirements, Runtime Environment Requirements, runtime values, dependency requirement, live profile runtime config, Agent Run Tools

**Agent Run Run Command Requirement**:
An Agent Run Runtime Requirement that runs a required-label, user-authored structured argv sandbox preparation command in sequence with environment Secret requirements. V1 Run Command Requirements store a label, arbitrary executable name, string arguments, optional sandbox working directory, and command-scoped `commandSecretEnv` record. They do not interpret shell operators such as `&&`, pipes, redirects, or `cd`; chaining is represented by multiple requirements and directory changes use the working-directory field. Run commands execute inside the sandbox namespace with an optional sandbox path working directory that defaults to `/workspace`; host absolute paths and parent traversal are invalid. V1 uses a Core-owned default sandbox command timeout rather than storing per-command timeout policy. Run Command Requirements may carry `commandSecretEnv` as a record from environment variable name to Secret id for that requirement's command execution only; those Secrets are resolved just-in-time and are not persisted into the sandbox runtime environment store. Environment Secret requirements add or update values in the sandbox runtime environment store, while Run Command Requirements let users add custom preparation commands; every sandbox run command automatically loads the current prepared sandbox runtime environment store.
_Avoid_: Agent Run Tool, model tool call, runtime value, dependency requirement, raw shell string, shell transcript event

**Agent Run Runtime Requirement Override**:
A consumer-authorized batch of one or more Agent Run Runtime Requirements appended directly to an active Agent Run and materialized on the Agent Run alongside its transcript event. Runtime Requirement Overrides do not remove existing requirements; environment Secret assignments and run commands are applied in sequence, repeated environment variable names use last-write-wins semantics, and exact duplicate requirements are rejected as redundant.
_Avoid_: live profile edit, requirement removal, dependency override, sandbox patch

**Agent Run Profile**:
A Portfolio-owned archivable reusable configuration surface for new Agent Runs. Selecting an Agent Run Profile supplies Core-owned run behavior such as Model Use Config, the explicit Core-normalized ordered Agent Run Runtime Requirements sequence, and an Agent Run Sandbox Config. An empty runtime requirement array means the profile contributes no requirements; archived Agent Run Profiles remain historical records but are not selectable for new work.
_Avoid_: agent config, runtime profile, provider profile, model provider profile

**Agent Run Profile Snapshot**:
The copied profile selection stored on an Agent Run when it is created, containing the selected Agent Run Profile id, profile name, Model Use Config, Core-normalized ordered Agent Run Runtime Requirements, and Agent Run Sandbox Config. Agent Run Profile Snapshots make profile edits apply only to future Agent Runs.
_Avoid_: live profile pointer, model selection event, profile reference

**Agent Run Profile Reference**:
A direct Core-owned usage of an Agent Run Profile by a stored reusable configuration model that may select that profile for future Agent Runs. V1 Agent Run Profile References come from Project Config and Delivery Config, distinguish execution and revision-execution roles, treat a null revision-execution profile as using the execution profile, include closed Delivery Config references as inactive, and exclude Agent Run Profile Snapshots, current Agent Run Model Use Overrides, and transcript history.
_Avoid_: Agent Run history, profile snapshot usage, profile reference count

**Agent Run Model Use Override**:
A consumer-authorized current Model Use Config stored on an Agent Run that supersedes the Agent Run Profile Snapshot for later turns without changing the selected Agent Run Profile. Transcript events may preserve model switch history, but the override is the current runtime selection.
_Avoid_: profile switch, transcript-selected model, live profile edit

**Agent Run**:
One concrete application-managed session where an agent carries out goal-directed work for Gorchestra. An Agent Run is the session boundary; do not introduce a separate Agent Run Session concept or checkpoint record in v1. Runtime resumability and debugging facts belong in Agent Run Events. An Agent Run records its agent, purpose, Agent Run Profile Snapshot, `sourceRuntimeRequirements` for source/purpose-contributed Agent Run Runtime Requirements, optional Agent Run Model Use Override, additive Agent Run Runtime Requirement Overrides, the materialized ordered desired Agent Run Runtime Requirements, and sandbox runtime readiness. Newly-created Model Agent Runs resolve source runtime requirements before being stored. A null Agent Run sandbox field means no sandbox has been successfully created and recorded; a non-null sandbox state always includes created lifecycle evidence, the sandbox key, applied runtime requirements, preparation freshness, and release state. It records its purpose with the domain target it works on, such as a Planning purpose for a Plan or a Slice execution purpose with Delivery, Slice, and an execution mode union. A newly created Model Agent Run starts with an `instruction-snapshot` Agent Run Event and an accepted Agent Run Preparation Core Dispatch Request before purpose-specific input events are appended. Initial Slice execution has no correction root; correction Slice execution records the Failure Chain root it is correcting. Agent Runs may gather information, use tools, edit code, run tests, produce outputs, or request human decisions. Core owns Agent Run behavior; an Agent Run does not own authoritative Delivery or Slice Work State.
_Avoid_: Mission, Turn, AgentAttempt, Agent Run Session, Agent Run Checkpoint, actor

**Model Step**:
One AI SDK language-model invocation inside a Core Agent Run Turn. A Model Step may produce assistant output and tool calls; Core records the finalized model output as one `assistant-message` Agent Run Event and records Core-executed tool outputs for that assistant message as a grouped `tool-message` Agent Run Event. Model Step order is derived from ordered `assistant-message` events within the turn rather than from an AI SDK step number.
_Avoid_: Turn, tool run, Agent Run, AI SDK step id

**Blocked Agent Run**:
An active Agent Run whose completed lifecycle field is null and whose blocked field records why Core must not start another model turn yet. New Agent Runs and accepted Runtime Requirement Overrides set a preparation-pending block until Agent Run Preparation succeeds or records a failure. A preparation failure block includes a structured failure target for sandbox provider/lifecycle setup or a failed runtime requirement with its ordered requirement index, while detailed block history and sanitized evidence belong in Agent Run Events rather than the materialized blocked field.
_Avoid_: Completed Agent Run, failed Agent Run, paused Agent Run, stopped Agent Run

**Agent Run Event**:
An ordered event in an Agent Run transcript. Agent Run Events record Core-recognized facts such as Agent Run Model Use Override history, Agent Run Runtime Requirement Overrides, Agent Run Preparation and Sandbox release history, turn context boundaries, interrupt requests, proposed outputs, proposal review, and compaction boundaries, plus durable Agent Run Transcript Parts needed to rebuild future agent context. Input, assistant, and tool transcript messages are recorded by distinct `input-message`, `assistant-message`, and `tool-message` Agent Run Event variants rather than a generic message-appended event, so turn production and tool-response links are represented by the event variant. Agent Run Event ids use Core Id ordering semantics for transcript order, event references, context boundaries, and list-query windows. Live model or tool update deltas may stream to subscribers without becoming durable Agent Run Events.
_Avoid_: Session Entry, transcript row, checkpoint

**Agent Run Transcript Part**:
A Core-owned persisted AI SDK-compatible message part used for Agent Run history and future agent context projection. Input, assistant, and tool transcript roles are distinguished by their Agent Run Event variant, while event bodies store parts such as operator input, runtime input, assistant output, tool calls, tool results, displayable reasoning, sources, generated files, and compaction summaries; each part's type determines whether it is included in later agent context. Generic part metadata is preserved on the owning part rather than as a separate Core transcript part, and context projection maps that metadata to AI SDK provider metadata or provider options when appropriate. Live stream starts, stream deltas, and provider telemetry are not Agent Run Transcript Parts. Operator-provided transcript parts record the consumer-authorized append operation rather than separate semantic authorship.
_Avoid_: Model Message, raw AI SDK message, provider stream event, streaming delta, Core-invented transcript part

**Agent Run Context Compaction**:
An Agent Run Event that replaces earlier context-visible transcript content with compacted system-projected Agent Run Transcript Parts for future context rebuilds while preserving the original events for audit and history. Agent Run Context Compaction records the inclusive Agent Run Event id compacted through, rather than the first later event to keep, so the compaction states exactly which prior context the replacement parts cover.
_Avoid_: Context deletion, transcript truncation, first kept id, chat reset

**Core Dispatch Request**:
A Core-originated request for a Consumer to arrange runtime execution for already-recorded Core work, such as an Agent Run model turn, Agent Run Preparation, Agent Run Sandbox Release, Delivery Work Scheduler Pass, or Delivery Work Operation. A Core Dispatch Request records that execution should be arranged; it is not proof that execution has started or completed. Each request carries Dispatch Coordination Claims that tell Consumers which readied requests may run concurrently. In v1, Agent Run lifecycle request types are `agent-run-model-turn`, `agent-run-preparation`, and `agent-run-sandbox-release`, each with an exclusive Agent Run claim. Dispatch request acceptance and dispatch processing are separate: Core may accept a request transactionally while the Consumer starts processing only after the write transaction succeeds.
_Avoid_: Scheduler job, background job, runtime event, generic agent-run request

**Dispatch Coordination Claim**:
A Core-supplied concurrency claim on a Core Dispatch Request. A claim names a hierarchical Dispatch Coordination Scope and either requires exclusive access to that scope or consumes one slot from a shared-capacity scope. A request may carry multiple claims and may run only when all of them can be acquired. This lets Delivery-level work exclude Slice-level work for the same Delivery while Slice-level work can still run with bounded parallelism across sibling Slices. Dispatch Coordination Claims are not idempotency or coalescing keys: each readied request remains an independent execution attempt. Among acquirable requests, Consumers prefer broader parent scopes before descendant scopes, with FIFO as the tie-breaker. If a Consumer runtime handles multiple Portfolio storage namespaces, it scopes Core-supplied claim scopes by that namespace before enforcing coordination.
_Avoid_: idempotency key, scheduler job id, typed dispatch target, flat serialization key, serialization-only key

**Interactive Agent Run**:
An Agent Run that remains open for human steering and may receive new human messages until its target domain object closes. Planning and Revision Planning Agent Runs are Interactive Agent Runs in v1. Closing a Plan or Revision Gate blocks further input and model turns for the associated Interactive Agent Run and records runtime completion on that Agent Run as a side effect; pending proposal review remains separate from target closure. Human-reviewable proposal events belong only to Interactive Agent Runs.
_Avoid_: Human-in-the-loop Agent Run, chat session

**Autonomous Agent Run**:
An Agent Run that executes without ongoing human steering and sets its completed lifecycle field when its model/tool loop finishes. Slice execution and Revision execution Agent Runs are Autonomous Agent Runs in v1; Core evaluates their sandbox or artifact output after completion.
_Avoid_: Background job, one-shot task

**Agent Run Sandbox**:
The isolated environment an Agent Run uses for its work, such as a worktree, temporary files, tools, and runtime environment. Core owns Agent Run orchestration semantics, while Sandbox Providers create, find, command, store files for, and release deployment-specific execution isolation. An Agent Run Sandbox is isolated to one Agent Run; cross-run state must be promoted by Gorchestra evaluation.
_Avoid_: Mission Sandbox, Execution Sandbox, shared sandbox, workspace, project checkout

**Agent Run Sandbox Config**:
The saved Agent Run Profile configuration that declares how future Agent Run Sandboxes should be sourced and constrained. It includes one sandbox source variant, explicit vCPU resources, and network policy. V1 sources are Core-owned Vercel runtime, Core-owned Vercel VCR image, and Consumer-managed OCI image. Vercel source configs carry Secret references for token, team id, and project id; Consumer-managed source configs carry an OCI image string without saying whether the Consumer implementation is local or remote. Saved resources store only vCPUs; runtime memory is inferred as 2048 MiB per vCPU.
_Avoid_: sandbox assignment, live sandbox state, runner config, deployment-specific local sandbox

**Sandbox Provider**:
The executable provider Core resolves from an Agent Run Sandbox Config before creating, finding, commanding, or releasing an Agent Run Sandbox. Core owns Vercel Sandbox Provider behavior and resolves the configured Vercel credential Secrets before constructing it. Consumer-managed sandbox configs resolve to the Consumer-provided Sandbox Provider. Raw Sandbox Providers expose deployment-specific sandbox creation, lookup, command execution, file storage, and release; Core-managed Sandbox Providers add Core-owned runtime environment store semantics, command output validation, Secret redaction, normalized command summaries, and best-effort runtime environment store wiping before sandbox release.
_Avoid_: Sandbox Service, Sandbox Runtime, source config, assignment

**Agent Run Sandbox Key**:
The Core-owned persisted key used to create, find, and release the concrete Agent Run Sandbox for one Agent Run. In v1, Core initializes the key to the Agent Run id. The key is not portable proof that a restored deployment still has a live sandbox with that key.
_Avoid_: assignment ref, sandbox id, portable sandbox reference

**Agent Run Profile Preflight**:
An observational validation operation that checks whether a saved Agent Run Profile's Agent Run Sandbox Config can currently create, set a runtime environment value, command, and release a sandbox. Agent Run Profile Preflight returns transient Validation Evidence and does not mutate Portfolio facts. V1 preflight creates a temporary sandbox, stores a dummy runtime environment value, verifies that a command can read it, and releases the sandbox; expected readiness failures such as missing or inactive Vercel credential Secrets or sandbox command failures are failed Validation Evidence, while missing target profiles, storage failures, and invalid Core Service Outputs remain operation errors.
_Avoid_: Core preflight sandbox check, profile readiness state, sandbox lifecycle event

**Agent Run Preparation**:
The idempotent runtime work that clears a preparation-pending Blocked Agent Run by making the Agent Run Sandbox fully ready for the Agent Run's ordered Agent Run Runtime Requirements. When preparation work is needed, Core first records an `agent-run-preparation-started` event for the preparation attempt. Core resolves the Agent Run Profile Snapshot's Agent Run Sandbox Config into a Sandbox Provider, creates a missing sandbox or finds an already-recorded sandbox by Agent Run Sandbox Key, records non-null Agent Run sandbox state only after sandbox creation succeeds, and applies source requirements before profile and override requirements. Environment Secret preparation updates a sandbox-local runtime environment file or store that future sandbox commands and tools load until release/wipe. Core passes plaintext Secrets to sandbox commands only through typed transient secret input fields such as `commandSecretEnv`, never through command arguments or stored command evidence. Command execution returns only validated sanitized output such as exit status, summary, and optional redacted snippets. Preparation records aggregate started/completed/failed attempt events with sanitized evidence, environment Secret readiness, command summaries, and the ordered sequence of successfully applied requirement steps; Core does not store one Agent Run Event per sandbox command. A model-turn dispatch that finds the Agent Run blocked or sandbox not fully prepared no-ops without adding skipped-turn transcript events.
_Avoid_: Agent Run Sandbox Preparation, Sandbox Assignment, project install, dependency requirement, dependency install, workspace setup

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
A Portfolio-owned note-like and collection-capable item in Portfolio Memory. A Memory stores its current revision snapshot for fast reads, has durable Memory Revision history, may contain child Memories through its immutable parent relationship, and is a stable Portfolio Graph node for the note identity.
_Avoid_: Wiki, file, workspace note, folder-only record

**Memory Revision**:
An append-only record of a Memory's editable content at one save point. Memory Revisions preserve title and body history, while Memory stores the current revision snapshot for current reads. Memory Revision is a Portfolio Graph node so provenance can target the exact content snapshot a Plan produced.
_Avoid_: embedded revision array, edit-in-place fields, draft

**Standalone Memory**:
A Memory with no Memory Inline Links. A Standalone Memory still belongs to Portfolio Memory and may link to other Memories later.
_Avoid_: Orphan Memory, unowned Memory

**Current Memory**:
A Memory that has not been superseded by another Memory.
_Avoid_: Active Memory, latest Memory, unsuperseded Memory

**Superseded Memory**:
An older Memory that has been replaced by one or more newer Memories through Memory Supersession.
_Avoid_: Deleted Memory, outdated record, superseding Memory

**Memory Inline Link**:
An authored link in a Memory Revision body that points to another Memory.
_Avoid_: Core Link, edge, separate relationship record

**Memory Supersession**:
The relationship where one Memory replaces another Memory without deleting it. Supersession is represented through Memory-authored context rather than by editing or deleting the superseded Memory, so the superseded Memory remains inspectable.
_Avoid_: Memory revision, Memory overwrite, Memory deletion

**Link**:
A typed directed relationship between Core graph nodes for system provenance or execution dependency semantics. Portfolio is the graph boundary, not a graph node. Links connect graph nodes, not other Links. A Link has one immutable Link Definition that names the relationship type and its `from` and `to` Graph Node Refs. V1 Links are immutable and non-removable after creation. V1 Core Link types are `produced` and `depends-on`. A produced Link records exact Core provenance from a Plan to a Memory or Memory Revision. A depends-on Link is a hard execution gate: the `from` node cannot run or complete correctly until the `to` node completes. V1 depends-on Links connect Deliveries within the same Project or Slices within the same Delivery. User-authored Memory-to-Memory references, support, contradiction, and supersession are expressed as Memory Inline Links instead of Core Links.
_Avoid_: Memory Inline Link, relationship, edge, reference, edge-as-node

**Link Definition**:
The relationship-defining part of a Link: its source and target Graph Node Refs plus the relationship type for that supported endpoint pair. In v1, each supported endpoint pair has one supported relationship type, such as a Plan producing a Memory, but the type remains part of the Link Definition so relationship-specific behavior does not rely on endpoint shape alone. Link Definition fields are immutable because the type and endpoints are one graph fact rather than three independent fields.
_Avoid_: link metadata, link payload, loose endpoint fields

**Preflight**:
A readiness validation performed before Gorchestra begins or resumes work. Top-level Core preflight is an opened-Core API that checks required deployment mechanics such as storage, Secrets, and Agent Run Sandbox. Its storage check verifies that Core can reach the configured storage boundary without auditing all stored Portfolio facts. It returns a transient readiness report for consumers and does not check optional logger/event publishing, Core-owned time/identifier mechanics, or provider-specific readiness. Delivery work scheduling resolves local Delivery Work Resolution before queueing operation requests, after cheap closed, unqueued, dependency-blocked, and preflight-failed gates. Provider-backed Delivery preflight checks the Delivery target Repository and the selected execution Model inside Process Delivery Work Operation before external side effects. Successful Delivery preflight is normally not stored, except when explicit retry supersedes the latest failed Delivery preflight Action; failed Delivery preflight is recorded as a validate-preflight Action whose component checks determine whether the preflight passed. Explicit Delivery preflight retry records both passing and expected failed readiness outcomes as Delivery preflight Actions; setup-incomplete readiness, such as missing or inactive Agent Run Profile selection, is preflight evidence, while storage failures, invalid Core Service Outputs, and missing referenced Portfolio facts that should exist remain operation errors rather than preflight evidence. A Delivery Work Scheduler Pass records Core Dispatch Requests from the Delivery Context and Delivery Work Resolution it read at the start of the pass; later changes apply to later passes. Delivery work concurrency is coordinated by Dispatch Coordination Claims rather than a separate Core-owned Delivery lease in v1. A Delivery whose latest Delivery preflight Action failed is preflight-failed until an explicit retry records a later passing Delivery preflight Action. Other preflight results, such as explicit Repository preflight, may be returned to consumers as safe validation evidence without storing Actions or authoritative Portfolio facts. Preflight may check Project, Repository, Model Provider, Model, Secret, Agent Run Profile, Agent Run Runtime Requirements, or execution target readiness.
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
Human-controlled artifact-scoped authorization that allows Gorchestra to plan revision work in response to fetched Feedback for a Slice Artifact or Delivery Artifact. Opening a Revision Gate starts revision planning with a selected Agent Run Profile while the gate is open, and accepting a Revision Output consumes the gate. A Revision Gate remains open until it is explicitly closed without a Revision or consumed by an accepted Revision; gate closure or consumption completes the associated Revision Planning Agent Run when it is still open. Revision Gate does not create or reopen Slices.
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
