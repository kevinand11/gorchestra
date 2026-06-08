# Issue 42 coverage matrix

This document maps GitHub issue #42 and its follow-up comments to the current Gorchestra documentation. It is not a domain glossary, implementation spec, or ADR. Its purpose is to show which design points have been captured, superseded, deferred, or still need a PRD/spec.

Issue source: <https://github.com/kevinand11/trowel/issues/42>

## Status meanings

- **Covered** — captured in current glossary, ADRs, or TypeScript documentation sketches.
- **Superseded** — original issue language was intentionally replaced by later Gorchestra terminology or model decisions.
- **Partial** — direction is captured, but exact implementation/product behavior still needs a PRD or spec.
- **Deferred** — intentionally not part of v1/current docs.
- **Not needed** — transcript/process material, not a durable product/domain decision.

## Current canonical documentation

- Context map: `AGENTS.md`
- Core glossary: `docs/core/CONTEXT.md`
- Core ADRs: `docs/core/adr/`
- Core TypeScript sketches: `docs/core/model.ts`, `docs/core/api.ts`
- Consumer glossary: `docs/consumers/CONTEXT.md`
- Consumer ADRs: `docs/consumers/adr/`
- Server Consumer glossary: `docs/consumers/server/CONTEXT.md`
- Server Consumer ADRs: `docs/consumers/server/adr/`

## Original issue body coverage

| Issue section | Current canonical terms / decision | Status | Current docs | Notes |
|---|---|---:|---|---|
| 1. Existing local CLI context | Gorchestra Core, Consumers, future CLI Consumer | Covered / Superseded | `AGENTS.md`; `docs/core/CONTEXT.md`; `docs/consumers/CONTEXT.md` | Old CLI-first assumptions are not the target architecture. CLI is future consumer only. |
| 2. Web migration problem | Core operations consumed by Server Consumer; Consumers authorize before Core calls | Covered | `AGENTS.md`; `docs/consumers/adr/2026-06-07-1015-consumer-authorized-core-operations.md` | The issue's CLI-to-server mapping is reflected as reusable Core plus Consumer boundaries. |
| 3. GitHub access discussion | GitHub-only Source Control Projects in v1; GitHub PAT as Secret | Covered / Partial | `docs/core/CONTEXT.md`; `docs/core/adr/2026-06-07-0915-github-only-source-control-projects.md`; `docs/core/adr/2026-06-07-0910-portfolio-owned-secrets.md` | PAT direction is captured. Exact PAT validation, expiry, and warning UX still need implementation spec. Safety boundary around not hiding/bypassing repository policy should be carried into product requirements. |
| 4. Credential model | Secret, Secret Binding, GitHub PAT, Environment Variable | Covered / Superseded | `docs/core/CONTEXT.md`; `docs/core/adr/2026-06-07-0910-portfolio-owned-secrets.md`; `docs/core/model.ts` | Original `Credential` term is superseded by `Secret`. Ownership moved from workspace/project to Portfolio. |
| 5. PAT lifespan | Secret replacement; Preflight/SourceControl validation hooks | Partial | `docs/core/model.ts`; `docs/core/api.ts` | Replacement exists in model/API sketch. Expiry detection, rotation UX, and degraded-permission behavior need PRD/spec. |
| 6. Secret storage and export/import | Portfolio Snapshot, Export, Import, passphrase-encrypted full Snapshot; consumer-specific Secret protection | Covered | `docs/core/CONTEXT.md`; `docs/core/adr/2026-06-07-0905-passphrase-encrypted-exports.md`; `docs/core/adr/2026-06-07-0910-portfolio-owned-secrets.md` | Snapshot includes Secrets. Server-at-rest protection remains consumer-specific. Imported audit attribution is captured separately. |
| 7. Data store discussion | File storage first with Equipped ORM; Portfolio-scoped storage | Covered / Partial | `docs/core/adr/2026-06-07-0925-file-storage-first-with-equipped-orm.md`; `docs/core/adr/2026-06-07-0930-portfolio-scoped-storage.md`; `docs/core/api.ts` | Direction is documented. Exact schema, migrations, indexes, and transaction boundaries remain implementation work. |
| 8. Doctor discussion | Preflight | Partial / Superseded | `docs/core/CONTEXT.md`; `docs/core/model.ts`; `docs/core/api.ts` | Original `Doctor` term is superseded. Preflight exists as validation concept/API hook; no ADR yet explicitly says “validation primitive, not job.” |
| 9. Agent harness discussion | ModelAgentRuntimePort; Agent Run | Partial / Superseded | `docs/core/CONTEXT.md`; `docs/core/api.ts` | CLI harness compatibility is superseded by an abstract Agent Run runtime port. Provider-specific Claude/Codex/Pi SDK contracts remain unspecified. |
| 10. Pi agent discussion | ModelAgentRuntimePort; Core ports | Partial / Deferred | `docs/core/api.ts` | Tool boundary is abstracted. Pi-specific SDK/tool behavior is intentionally not designed in current docs. |
| 11. Turn semantics | Agent Run | Covered / Superseded | `docs/core/CONTEXT.md`; `docs/core/model.ts` | Original `Turn` / `AgentAttempt` terms are superseded by `Agent Run`. |
| 12. Agent work boundary | Agent Run Sandbox isolation; Gorchestra-owned lifecycle mutations | Covered | `docs/core/adr/2026-06-07-0920-gorchestra-owned-lifecycle-mutations.md`; `docs/core/adr/2026-06-07-1100-isolated-agent-run-sandboxes.md` | Intelligence works in sandboxes; Core evaluates/promotes and owns authoritative mutations. |
| 13. Grilling discussion | Plan, Planning, Planner, Plan Output, atomic Plan Output acceptance | Covered / Superseded | `docs/core/CONTEXT.md`; `docs/core/adr/2026-06-07-0950-atomic-plan-output-acceptance.md` | Original `Grill` language is superseded by `Plan`/`Planning`. |
| 14. Job orchestration discussion | Delivery execution, Action, Agent Run; Delivery Config | Partial / Superseded | `docs/core/CONTEXT.md`; `docs/core/model.ts` | Domain hierarchy is documented. Delivery execution limits now live on Delivery config rather than a separate Execution Policy model. Scheduler claim/lock/heartbeat/retry/cancellation details still need implementation spec. |
| 15. WorkRun discussion | Delivery execution through Actions and Agent Runs | Covered / Superseded | `docs/core/CONTEXT.md`; `docs/core/model.ts`; `docs/core/api.ts` | Original `WorkRun` term is superseded; there is no separate stored Execution model in v1. |
| 16. Pause discussion | Decision | Partial / Deferred | `docs/core/CONTEXT.md`; `docs/core/model.ts` | Decision remains a core concept, but pause/resume behavior and Decision-raising actions are not specified in v1 sketches yet. |
| 17. Decisions discussion | Decision | Partial | `docs/core/CONTEXT.md`; `docs/core/model.ts`; `docs/core/api.ts` | Core concept exists. Exact decision payloads, expiration, and who may answer decisions need PRD/spec. |
| 18. State and Timeline discussion | Store facts, compute state; derived Timeline | Covered | `docs/core/adr/2026-06-07-0935-store-facts-compute-state.md`; `docs/core/adr/2026-06-07-0940-derived-timeline.md`; `docs/core/CONTEXT.md` | Timeline records are not stored. API sketch includes a derived Timeline query shape. |
| 19. Workspace execution environment | Agent Run Sandbox; isolated work per Agent Run | Covered / Partial | `docs/core/CONTEXT.md`; `docs/core/adr/2026-06-07-1100-isolated-agent-run-sandboxes.md` | Isolation is documented. Janitor interval, disk quotas, debug retention, and cleanup failure behavior need implementation spec. |
| 20. Branch handling | Target Branch, Delivery Branch, Slice Branch; Review Surfaces | Covered | `docs/core/CONTEXT.md`; `docs/core/adr/2026-06-07-1105-source-control-delivery-and-slice-branches.md`; `docs/core/adr/2026-06-07-1140-source-control-review-surfaces.md` | Branch creation, promotion, and review relationships are documented. |
| 21. Configuration discussion | Project/Repository config, Delivery Config, Secrets, Secret Bindings | Partial | `docs/core/model.ts`; `docs/core/api.ts`; relevant Core ADRs | Stable model/config pattern exists in sketches. Full layered config resolution semantics are not yet a standalone spec. |
| 22. Workspace scope discussion | Server Consumer Workspace boundary; default Portfolio per Workspace; Workspace-level Portfolio access | Covered | `docs/consumers/server/CONTEXT.md`; `docs/consumers/server/adr/2026-06-07-1020-default-portfolio-per-workspace.md`; `docs/consumers/server/adr/2026-06-07-1030-workspace-level-portfolio-access.md` | Workspace is server-app tenancy, not Core. |
| 23. Product document discussion | Transcript is source context, not final PRD/ADR set | Not needed | This file | This section is meta-guidance rather than a product/domain decision. |
| 24. Accepted decisions summary | Captured across current docs with updated terminology | Covered / Superseded | `AGENTS.md`; `docs/core/CONTEXT.md`; ADR directories | Later issue comments and this session superseded several original terms and boundaries. |
| 25. Explicitly rejected alternatives | Rejections appear as rationale in ADRs where still relevant | Partial | ADR directories | Not every rejected alternative gets its own ADR. This matches the current ADR rule: only durable, surprising trade-off decisions become ADRs. |
| 26. Open questions for next agent | Implementation/spec backlog | Partial / Deferred | `docs/core/api.ts`; this file | Many open questions remain intentionally outside glossary/ADR: schema, scheduler, SDKs, GitHub operations, exact Timeline/Decision schemas, cleanup, export format, UI. |
| 27. Guidance to future agent | Current docs are not final implementation plan | Not needed | `AGENTS.md`; this file | Process guidance, not domain documentation. |

## Follow-up comment coverage

| Comment | Topic | Current canonical terms / decision | Status | Current docs | Notes |
|---:|---|---|---:|---|---|
| 1 | Goal layer | Goal dropped from v1 | Superseded | `docs/issue-42-coverage.md` | Goal is no longer a stored v1 core model. Use Project-level Plans, Portfolio Memories, and Links instead; goal-like grouping can be reconsidered later if product needs it. |
| 2 | Revision workflow without GitHub labels | Review Surface, Feedback, Revision Gate, Revision Output, Revision, Revision Disposition | Covered / Superseded | `docs/core/CONTEXT.md`; `docs/core/adr/2026-06-07-1125-review-surface-sourced-feedback.md`; `docs/core/adr/2026-06-07-1130-artifact-level-revision-work.md`; `docs/core/adr/2026-06-07-1135-revision-output-for-feedback-work.md` | GitHub labels and review-state dependency are avoided in v1. |
| 3 | Workspace identity, membership, roles, ownership | User, Workspace, Workspace Member, membership history, Workspace Owner, Portfolio Owner | Covered | `docs/consumers/CONTEXT.md`; `docs/consumers/server/CONTEXT.md`; server ADRs | Core no longer stores server-specific identity; core attribution uses local/imported Audit Stamps. |
| 4 | Deployment, packaging, distribution | Monorepo with single published `gorchestra` package; Core + Consumer architecture | Covered / Partial | `AGENTS.md`; `docs/consumers/adr/2026-06-07-1005-monorepo-with-single-published-package.md` | Package direction is captured. Detailed package responsibilities/build pipeline remain implementation planning. |
| 5 | Rename from Trowel to Gorchestra | Gorchestra | Covered | `AGENTS.md`; all current context docs | Old name appears only in issue/source references or explicit superseded-term discussions. |
| 6 | Plan entity and Goal associations | Plan, Planning, Plan Output; Goal dropped from v1 | Covered / Superseded | `docs/core/CONTEXT.md`; `docs/core/adr/2026-06-07-0950-atomic-plan-output-acceptance.md`; `docs/core/adr/2026-06-07-0945-link-immutability-rules.md` | Plan belongs to a Project. Goal is not a stored v1 core model; use Project-level Plans, Portfolio Memories, and Links instead. |
| 7 | Project Source Type modeling | Project Source Type, Source Control Project, Project config | Covered | `docs/core/CONTEXT.md`; `docs/core/model.ts`; `docs/core/adr/2026-06-07-0915-github-only-source-control-projects.md` | v1 supports GitHub Source Control Projects only, while keeping Project Source Type language broader. |
| 8 | Wiki graph and Link model | Portfolio Memory, Memory, Current Memory, Link, derived Timeline | Covered / Superseded | `docs/core/CONTEXT.md`; `docs/core/adr/2026-06-07-0900-portfolio-and-project-memory.md`; `docs/core/adr/2026-06-07-0945-link-immutability-rules.md`; `docs/core/adr/2026-06-07-0940-derived-timeline.md` | Original `Wiki` term is superseded by `Memory`. Links connect graph nodes, not Links. |
| 9 | Credential model | Secret, GitHub PAT, Environment Variable, Secret Binding | Covered / Partial / Superseded | `docs/core/CONTEXT.md`; `docs/core/adr/2026-06-07-0910-portfolio-owned-secrets.md`; `docs/core/model.ts`; `docs/core/api.ts` | Secret visibility and non-logging direction is captured. Detailed environment resolution precedence and Doctor/Preflight checks need implementation spec. |
| 10 | Multi-repository Projects and Delivery targeting | Source Control Project manages many Repositories; Delivery targets exactly one Repository; Plan may coordinate multiple Deliveries/Repositories | Covered / Superseded | `docs/core/CONTEXT.md`; `docs/core/model.ts`; `docs/core/adr/2026-06-07-0955-delivery-and-slice-dependency-boundaries.md` | Original allowed cross-Change/cross-repository Slice dependencies and kept Slices outside graph. Current model supersedes that: Slices are graph nodes; Slice dependencies are same-Delivery only; cross-Repository ordering is Delivery-level. |
| 11 | Delivery execution model | Delivery execution, Action, Agent Run | Covered | `docs/core/CONTEXT.md`; `docs/core/model.ts`; `docs/core/api.ts` | Delivery execution is recorded through Actions and Agent Runs without a separate Execution model. |
| 12 | Agent Run model | Agent Run, planning Agent Run, execution Agent Run, Decision | Covered | `docs/core/CONTEXT.md`; `docs/core/model.ts`; `docs/core/api.ts` | Agent Run is not repository-specific and does not own authoritative state. |
| 13 | Workflow Project Source Type V2 | Future Project Source Type possibility | Deferred / Partial | `docs/core/CONTEXT.md` | `Project Source Type` glossary mentions workflow generically, but Workflow Project Source Type remains a V2 candidate and has no ADR/spec. This is intentional unless/until v2 planning starts. |

## Remaining documentation/spec work

These are the main issue-derived areas not fully captured as durable docs:

1. **Product safety guardrail for PAT usage** — Gorchestra must not hide activity, bypass repository policy, or impersonate someone beyond supplied permissions.
2. **PAT validation and expiry behavior** — exact checks, warnings, replacement flow, and failure states.
3. **Preflight spec** — exact checks and whether to add an ADR for Preflight as validation primitive rather than job.
4. **Scheduler spec** — claim algorithm, lock TTLs, heartbeats, retries, cancellation, and concurrency.
5. **Agent Run runtime/provider contracts** — Claude/Codex/Pi SDK boundaries, tool ownership, sandbox input/output validation.
6. **GitHub integration spec** — permissions, PR operations, branch operations, issue operations if any, review fetch/merge semantics in provider terms.
7. **Decision spec** — payload types, permissions to answer, expiration, resumption behavior.
8. **Timeline event taxonomy** — exact derived event types and UI payloads.
9. **Workspace/Agent Run cleanup spec** — janitor interval, disk quotas, debug retention, cleanup failures.
10. **Snapshot file format spec** — manifest schema, encryption algorithm, KDF, versioning, import compatibility.
11. **Web UI PRD** — workspace/project/delivery pages, decision UI, timeline UI, secret management UI.
12. **Workflow Project Source Type V2 note/spec** — only if/when v2 workflow orchestration becomes active work.

## Summary

The original issue's durable domain decisions are mostly represented, but not every point is documented as final product behavior. The current docs intentionally focus on canonical domain language, durable architecture decisions, and TypeScript model/API sketches. Detailed implementation concerns from issue #42 should become PRDs or specs before code work rather than being folded into `CONTEXT.md` or low-value ADRs.
