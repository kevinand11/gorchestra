# Gorchestra Core

The Gorchestra core is the reusable Portfolio-level orchestration context. It manages Portfolio data, planning, graph relationships, delivery execution, portable Portfolio Snapshots, and Project-level work without depending on server-app tenancy concepts.

## Language

**Portfolio**:
A core orchestration boundary that groups Projects and shared reusable context or resources such as Memories and Secret Bindings.
_Avoid_: Project Space, program, workspace

**Secret**:
A Portfolio-owned sensitive write-only value stored by Gorchestra for repository access or execution environments. Users may create or replace Secret values, but may not view plaintext values after creation.
_Avoid_: Credential, token, key, sensitive value

**Environment Variable**:
A Secret exposed to Missions as a named runtime environment variable.
_Avoid_: Environment, environment secret

**Secret Binding**:
A Portfolio-owned rule that makes a Secret available at a Portfolio, Project, Delivery, or Execution boundary.
_Avoid_: Secret Assignment, credential assignment

**GitHub PAT**:
A Secret that grants Gorchestra GitHub access using a user-supplied personal access token.
_Avoid_: GitHub token, GitHub credential

**Portfolio Snapshot**:
A passphrase-encrypted portable artifact containing Portfolio storage contents. Portfolio Snapshots always include Secrets and can be imported by any Gorchestra consumer with the passphrase.
_Avoid_: Backup, dump, workspace export

**Export**:
The operation that creates a Portfolio Snapshot.
_Avoid_: Backup, dump

**Import**:
The operation that creates a new Portfolio from a Portfolio Snapshot using its passphrase.
_Avoid_: Restore, upload, merge

**Project**:
An orchestration boundary inside a Portfolio where Gorchestra executes Deliveries against one or more execution targets. Project-specific planning context is expressed through Links to Portfolio-owned Goals, Plans, and Memories.
_Avoid_: Repository, repo

**Project Type**:
The kind of execution environment a Project manages, such as repository or workflow. A Project Type defines Delivery Artifact behavior, optional Slice Artifact behavior, Slice completion validation, Review Surface behavior, Feedback retrieval behavior, Ship behavior, and Abandon cleanup behavior.
_Avoid_: Project kind, target type

**Source Control Project**:
The v1 Project Type that manages one or more Repositories.
_Avoid_: Repository Project, Git project, repo project

**Repository**:
A Source Control Project-managed source control target. For Source Control Projects, a Delivery targets exactly one Repository, while Plans and Goals may coordinate work across multiple Repositories.
_Avoid_: Project, repo

**Goal**:
A Portfolio-level desired outcome and context container. A Goal provides long-range context and progress visibility across one or many Projects without owning Plans or Deliveries.
_Avoid_: Task, epic, Plan owner, Delivery owner

**Plan**:
A Portfolio-level reusable planning and discovery artifact. A Plan captures research, analysis, requirements, and architectural discussion, and may produce zero, one, or many Plan Outputs across one or many Projects.
_Avoid_: Grill

**Planning**:
The activity of exploring a problem and refining a Plan.
_Avoid_: Grilling

**Planner**:
The human steering Planning toward an acceptable Plan Output.
_Avoid_: Agent, intelligence, Plan owner

**Plan Output**:
A set of proposed new Deliveries with their initial Slices, plus Memories and Links, produced by Planning for review as a whole. Accepting a Plan Output adds those proposed artifacts to the Portfolio graph; rejecting it preserves the Plan Output in Planning history without materializing its proposed artifacts. Plan Outputs do not add Slices to existing Deliveries.
_Avoid_: Accepted Plan, partial acceptance, staged output set, draft Plan

**Delivery**:
The Project-level unit of accepted executable work materialized by accepting a Plan Output. A Delivery belongs to a Project for execution and participates in the Portfolio graph for planning, provenance, and Delivery-level dependencies. A Delivery targets exactly one execution target for its Project type, contains at least one Slice, and cannot begin while blocked by a prerequisite Delivery that is neither Shipped nor Abandoned.
_Avoid_: Change, task, ticket, draft Plan

**Shipped Delivery**:
A terminal Delivery whose external integration lifecycle has been completed.
_Avoid_: Released Delivery, landed Delivery

**Abandon**:
To terminally remove a Delivery from active execution consideration without shipping it, after required Project Type-specific cleanup is attempted or recorded.
_Avoid_: Archive, delete, cancel, soft-delete

**Abandoned Delivery**:
A terminal Delivery removed from active execution consideration without being Shipped. Abandoning a started Delivery must close or abandon active external work where possible. For dependency calculation, an Abandoned Delivery satisfies Delivery-level dependencies as if it were Shipped.
_Avoid_: Archived Delivery, Deleted Delivery, canceled Delivery, soft-deleted Delivery

**Slice**:
An independently executable unit inside exactly one Delivery. A Slice's parent Delivery is immutable after acceptance. Slices participate in the Portfolio graph, and Slice-level dependencies are represented by Links between Slices in the same Delivery.
_Avoid_: Step, task, subtask

**Execution**:
A single execution session for a Delivery. An Execution groups the Actions and Missions that attempt to move the Delivery forward across its Slices, but does not own lifecycle state.
_Avoid_: WorkRun

**Execution Policy**:
Project-level versioned rules controlling how Gorchestra schedules Actions and Missions, retries validation failures, and limits execution. In v1, Execution Policy includes max parallel Slices per Delivery, max validation retries, and Mission timeout. An Execution uses the Execution Policy version captured when it starts.
_Avoid_: Project Type, scheduler settings

**Mission Sandbox**:
The isolated environment a Mission spins up for its work, such as a worktree, temporary files, tools, and runtime environment. A Mission Sandbox is isolated to one Mission; cross-Mission state must be promoted by Gorchestra evaluation.
_Avoid_: Execution Sandbox, shared sandbox, workspace, project checkout

**Delivery Artifact**:
The Project Type-specific authoritative in-progress artifact for a Delivery, created lazily when execution first begins, promoted by Gorchestra from a Mission Sandbox after evaluation, and available to later Missions or Project Type-specific external mutations. Every Project Type defines its Delivery Artifact. For a Source Control Project Delivery, the Delivery Artifact is the Delivery Branch.
_Avoid_: Working Artifact, Working State, Mission Sandbox artifact, workspace, branch state

**Slice Artifact**:
A Project Type-specific temporary artifact for one Slice, created lazily when that Slice first begins. Project Types may define Slice Artifacts when they support isolated or parallel Slice work. A Slice with a Slice Artifact is complete only after the Slice Artifact is promoted into the Delivery Artifact and the resulting Delivery Artifact passes required validation. For a Source Control Project Slice, the Slice Artifact is the Slice Branch.
_Avoid_: Working Artifact, Mission Sandbox artifact, Delivery Artifact

**Delivery Branch**:
The Source Control Project representation of a Delivery Artifact. A Source Control Project Delivery has exactly one Delivery Branch, created from the Delivery's Target Branch when execution first begins and merged back into the Target Branch when the Delivery ships.
_Avoid_: Delivery Artifact, Mission Sandbox, Slice Branch

**Target Branch**:
The immutable source control branch a Source Control Project Delivery targets. The Delivery Branch is created from the Target Branch when execution first begins and merged back into the Target Branch when the Delivery ships. A Plan Output must specify a Target Branch for each Source Control Project Delivery.
_Avoid_: Base Ref, base branch, starting branch

**Slice Branch**:
The Source Control Project representation of a Slice Artifact. Slice Branch work is merged into the Delivery Branch before the Slice is complete.
_Avoid_: Slice Artifact, Delivery Branch, Mission Sandbox

**Action**:
A state transition attempt within an Execution. An Action records authoritative execution lifecycle facts after evaluating Mission output, validation, or external operation results. Validation failures may be collected and provided as input to a later Mission.
_Avoid_: Job

**Mission**:
Goal-directed work performed by an intelligence, which may be automated, human, or hybrid. A Mission may gather information, use tools, edit code, run tests, produce outputs, or request human decisions, but does not own authoritative state. Plans create interactive Missions; Actions may create execution Missions.
_Avoid_: Turn, AgentAttempt

**Decision**:
A request for human judgment raised during a Mission. A Decision captures a point where goal-directed work needs human input before it can continue.
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
A typed directed relationship between graph nodes such as Goals, Plans, Projects, Deliveries, Slices, and Memories. Portfolio is the graph boundary, not a graph node. Links connect graph nodes, not other Links. Common Link types include produced, implements, references, supersedes, supports, contradicts, and depends-on.
_Avoid_: Relationship, edge, reference, edge-as-node

**Preflight**:
A readiness validation performed before Gorchestra begins or resumes work.
_Avoid_: Doctor, health check

**Timeline**:
A Portfolio-level derived list of events that affect Portfolio state, computed from Gorchestra facts. Project, Delivery, and Slice timelines are filtered views of the Portfolio Timeline.
_Avoid_: Timeline Event records, log, activity feed

**Ship**:
To terminally complete a Delivery's external integration lifecycle after all of its Slices are complete and required Ship validation passes. For a Source Control Project, a Delivery is Shipped when its Review Surface is merged into the Target Branch, whether Gorchestra performs or observes the merge.
_Avoid_: Release, submit, land

**Review Surface**:
The place where Delivery or Slice work is presented for human or external review. For Source Control Projects, a Review Surface is a pull request.
_Avoid_: Pull request, review target, submission

**Slice Review Surface**:
A Review Surface for a Slice Artifact. For Source Control Projects, this is a pull request from the Slice Branch into the Delivery Branch.
_Avoid_: Slice PR, review target

**Delivery Review Surface**:
A Review Surface for a Delivery Artifact. For Source Control Projects, this is a pull request from the Delivery Branch into the Target Branch.
_Avoid_: Delivery PR, review target

**Revision Gate**:
Human-controlled artifact-scoped authorization that allows Gorchestra to plan revision work in response to fetched Feedback for a Slice Artifact or Delivery Artifact. Opening a Revision Gate starts a revision planning session that may produce rejected Revision Outputs until one is accepted or the gate is closed. Revision Gate does not create or reopen Slices.
_Avoid_: revisionAllowed, needs-revision, changes-requested, per-comment approval

**Revision Output**:
A stored human-reviewed proposal for revision work against a Delivery Artifact or Slice Artifact in response to fetched Feedback. A Revision Output accounts for fetched Feedback with a human-readable disposition, without storing Feedback details as authoritative Portfolio data. It is accepted or rejected as a whole and authorizes revision Missions when accepted. It does not create or reopen Slices.
_Avoid_: revision Slice, feedback Slice, partial acceptance, Plan Output

**Feedback**:
Review input fetched from a Review Surface. Feedback does not authorize revision work unless the Revision Gate is open.
_Avoid_: Review signal, stored comment
