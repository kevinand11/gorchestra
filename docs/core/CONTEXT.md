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
The kind of execution environment a Project manages, such as repository or workflow.
_Avoid_: Project kind, target type

**Repository Project**:
The v1 Project Type that manages one or more Repositories.
_Avoid_: Git project, repo project

**Repository**:
A Project-managed source control target. For repository Projects, a Delivery targets exactly one Repository, while Plans and Goals may coordinate work across multiple Repositories.
_Avoid_: Project, repo

**Goal**:
A Portfolio-level desired outcome and context container. A Goal provides long-range context and progress visibility across one or many Projects without owning Plans or Deliveries.
_Avoid_: Task, epic, Plan owner, Delivery owner

**Plan**:
A Portfolio-level reusable planning and discovery artifact. A Plan captures research, analysis, requirements, and architectural discussion, and may produce zero, one, or many Deliveries across one or many Projects.
_Avoid_: Grill

**Planning**:
The activity of exploring a problem and refining a Plan.
_Avoid_: Grilling

**Delivery**:
The Project-level unit of accepted executable work. A Delivery belongs to a Project for execution and participates in the Portfolio graph for planning and provenance. A Delivery targets exactly one execution target for its Project type.
_Avoid_: Change, task, ticket, draft Plan

**Slice**:
An independently executable unit inside a Delivery. Slices participate in the Portfolio graph, and Slice dependencies are represented by Links between Slices.
_Avoid_: Step, task, subtask

**Execution**:
A single execution session for a Delivery. An Execution groups the Actions and Missions that attempt to move the Delivery forward across its Slices.
_Avoid_: WorkRun

**Action**:
A state transition attempt within an Execution. An Action evaluates any Mission output and is the only concept that may transition lifecycle state.
_Avoid_: Job

**Mission**:
Goal-directed work performed by an intelligence, which may be automated, human, or hybrid. A Mission may gather information, use tools, edit code, run tests, produce outputs, or request human decisions. Plans create interactive Missions; Actions may create execution Missions.
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
A typed directed relationship between graph nodes such as Goals, Plans, Projects, Deliveries, Slices, and Memories. Portfolio is the graph boundary, not a graph node. Common Link types include produced, implements, references, supersedes, supports, contradicts, and depends-on.
_Avoid_: Relationship, edge, reference

**Preflight**:
A readiness validation performed before Gorchestra begins or resumes work.
_Avoid_: Doctor, health check

**Timeline**:
A Portfolio-level derived list of events that affect Portfolio state, computed from Gorchestra facts. Project, Delivery, and Slice timelines are filtered views of the Portfolio Timeline.
_Avoid_: Timeline Event records, log, activity feed

**Ship**:
To complete a Delivery's external integration lifecycle, such as opening, updating, merging, or otherwise finalizing its Review Surface.
_Avoid_: Release, submit, land

**Review Surface**:
The place where a Delivery is presented for human or external review. For repository Projects, the Review Surface is a pull request.
_Avoid_: Pull request, review target, submission

**Revision Gate**:
The human-controlled authorization that allows Gorchestra to begin revision work in response to feedback.
_Avoid_: revisionAllowed, needs-revision, changes-requested

**Feedback**:
Review input about a Delivery. Feedback does not authorize revision work unless the Revision Gate is open.
_Avoid_: Review signal, comment
