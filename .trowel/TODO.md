# Gorchestra TODO

_Last updated: 2026-07-02_

This is the single project TODO source. Keep project follow-ups here as Markdown task-list items; do not maintain separate TODO lists under `docs/`.

## Completed foundation retained for context

- [x] Make Plan creation single-step with `title`, `config`, and `initialMessage`.
  - Core creates the Plan, creates the Planning AgentRun, appends the initial model-selection event, appends the first operator `input-message`, and requests dispatch in one user-facing flow.
  - The Server Consumer Plan creation UI exposes `initialMessage`.
- [x] Trigger the model loop after initial Plan creation and later `sendAgentRunMessage` calls.
  - V1 direction implemented: Core requests Agent Run Dispatch inside the same transaction as input-message writes, and the Server Consumer enqueues in-memory dispatch work.
  - Provider calls remain outside storage transactions.
- [x] Implement concrete provider turn support for `openai-responses`.
  - Map Core messages/tools to OpenAI Responses request shape.
  - Generate OpenAI function tool `parameters` from Core tool input pipes via `v.schema(...)`.
  - Process OpenAI Responses stream events and map text/thinking/tool/stop/error/length/abort outcomes back to Core events.
  - Preserve supported OpenAI Responses replay metadata.
- [x] Resolve provider Secrets for model turns.
  - Plaintext Secret values exist only transiently at the provider boundary and are not stored on AgentRun context/events.
- [x] Add the Agent Run Event foundation for model selection, input, model/tool outcomes, proposal events, and proposal review events.
- [x] Add interactive Agent Run commands for sending messages, model selection, interrupts, context compaction, and proposal review.
- [x] Add generic Server Consumer setup for Model Providers, Models, and Portfolio Config so a normal user can configure a usable Planning Model.
  - Includes Model Provider/Model list, create, update, archive, unarchive, detail, reference visibility, and preflight surfaces.
  - Includes `/portfolio-config` with full Portfolio Config, Model Use Config, Model Thinking Level selection, and Delivery Work Config defaults.
- [x] Add Core/Server read paths for Portfolio Config, Model Providers, Models, Model References, and Secret References.
- [x] Require non-null Plan Config in Core and Server Plan creation while preserving the current Plan Config shape.
  - Inherited/default Planning Model selection is represented inside Plan Config.
  - Optional Plan-level Planning Model override is supported.
  - Plan creation is blocked with setup guidance when no usable active Model selection exists.

## Core Planning and AgentRun follow-ups

- [ ] Define the Planning agent instruction contract.
  - [ ] Decide the system/developer prompt text.
  - [ ] Decide what Project, Memory, existing Plan, and Portfolio context is included.
  - [ ] Decide when the agent should ask clarifying questions vs use `propose-plan-output`.
- [ ] Define Planning session completion semantics.
  - [ ] Decide whether accepting a Plan proposal completes the Planning AgentRun.
  - [ ] Decide whether rejected proposals keep the session open for more discussion.
  - [ ] Decide whether users need an explicit close/cancel Planning session command.
- [ ] Add Core-owned AgentRun concurrency protection.
  - [ ] Prevent two workers from running the same AgentRun concurrently.
  - [ ] Decide lease/lock/recovery behavior for interrupted half-written turns.
- [ ] Enforce Model context window limits through provider-aware token counting and context compaction.
  - Until then, Model context window values are setup/display metadata rather than runtime guards.
- [ ] Introduce explicit immutable revision-planning creation config, mirroring Plan creation config, so revision planning can select its initial Model and Model Thinking Level without using Delivery Config.
- [ ] Make non-runnable provider protocols visible as configured protocols without implying they can run Planning Agent turns until turn support exists.

## Server Consumer Planning UX follow-ups

- [ ] Build Planning session discovery and routing.
  - [ ] List active Planning AgentRuns for a Plan or Project.
  - [ ] Route users to the active Planning AgentRun transcript after Plan creation.
- [ ] Improve Plan detail event visibility beyond manual raw refresh.
  - [ ] Render transcript-style AgentRun events.
  - [ ] Show visible runtime/model error state.
  - [ ] Replace manual refresh with WebSocket/SSE or polling.
- [ ] Expose follow-up Planning controls in the Server Consumer.
  - [ ] Send another Agent Run message.
  - [ ] Interrupt an Agent Run when ready for users.
  - [ ] Select a different Agent Run Model when ready for users.
  - [ ] Compact Agent Run context when ready for users.
- [ ] Expose proposal review in the Server Consumer.
  - [ ] Accept/reject `proposed-plan-output` events.
  - [ ] Materialize accepted Plan Outputs through Core.

## Delivery work follow-ups

- [ ] Move same-Delivery worker exclusion into Core with a Core-owned Delivery work lease.
  - The near-term scheduler/consumer runtime must ensure only one worker processes a Delivery at a time, but this should not remain a consumer discipline requirement.
- [ ] Define preflight behavior for resumed incomplete Agent Runs whose stored Model differs from the current selected execution Model.
  - Likely direction: claim-specific preflight checks the AgentRun's stored Model for resumed work and the current selected execution Model for new Agent Runs.
- [ ] Allow Delivery Artifact, Slice Artifact, and Slice Delivery Artifact validation to run user-configured validation scripts in the future.
  - Until then, these validation gates record passing no-op Validation Evidence instead of executing external checks.
- [ ] Observe current Delivery and Slice Review Surfaces during awaiting-review work so merged or closed external review outcomes are recorded instead of returning no observed change.

## Runtime reliability follow-ups

- [ ] Replace v1 in-memory dispatch with a durable outbox/post-commit worker before production reliability claims.
  - Dispatch should survive process crashes.
  - Dispatch should run only after committed Portfolio data is visible.
- [ ] Add a dedicated Core storage audit that reads all Core storage records, validates them against Core-owned schemas, and reports sanitized aggregate storage validation and consistency failures outside top-level Core preflight.

## Server Consumer configuration follow-ups

- [x] Add a Project Config page at `/projects/:projectId/config` so Project-scoped Model References can navigate to the concrete configuration surface and users can edit Project Config without relying on lower-level APIs.

## Server Consumer UI plumbing follow-ups

- [x] Implement requestable awaitable confirm/prompt helpers in the Server Consumer client, inspired by `../stranerd/stranerd-mono/client/libs`, so pages like Model Provider detail do not manage booleans such as `isProviderArchiveConfirmationVisible` locally.
