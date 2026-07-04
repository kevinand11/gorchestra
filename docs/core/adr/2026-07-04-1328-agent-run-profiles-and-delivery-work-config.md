# Agent Run Profiles and Project-scoped Delivery work config

Core reusable run configuration now lives in Portfolio-owned, archivable Agent Run Profiles instead of scoped Model Use Config inheritance across Portfolio, Project, Plan, and Delivery config. An Agent Run snapshots the selected Agent Run Profile id, name, and Model Use Config at creation, while an optional audited Agent Run Model Use Override can change the current model/thinking for later turns without mutating the profile or transcript state authority.

We chose direct profile selection for Planning and Revision Planning, required Project Config for Delivery work defaults, and whole Delivery Work Config overrides so user-initiated planning is explicit, Delivery execution remains Project-scoped, and profile edits only affect future Agent Runs. V1 removes Portfolio Config and Plan Config rather than preserving empty defaulting surfaces; Delivery Work Config keeps the existing scheduler field names `maxProcessableSliceSlots` and `maxCorrectionRetriesPerFailure`, adds execution and nullable revision-execution Agent Run Profile ids, and drops the unused `modelTimeoutMs` runtime-policy field until timeout policy has a concrete home.

## Consequences

- Agent Run Profile create/update validates that its Model Use Config references an active Model, active Model Provider, and available Model Thinking Level.
- Model reference queries include Agent Run Profiles, but not per-run profile snapshots, current overrides, or override history events.
- Agent Run Profile reference queries include Project Config and Delivery Config references by execution/revision-execution role, include null revision-execution selections as revision-execution references to the execution profile, include closed Delivery Config references as inactive, and exclude per-run profile snapshots and transcript history.
- Project Config is source-type-agnostic and required on Project creation; source-specific setup remains in Project Source or source-specific records.
- Delivery Config may override the full Delivery Work Config for future work, but does not merge individual fields and does not apply to revision planning.
- Runtime model selection uses `agentRun.modelUseOverride?.modelUse ?? agentRun.profile.modelUse`; transcript history uses a model-use override changed event with nullable `modelUse`, and no initial model-selection event is emitted.
- Because Core is pre-v1, storage schemas, baseline migrations, fixtures, and API shapes move directly without compatibility migrations.

Supersedes the scoped config inheritance consequences in [Model use config and Model capability metadata](./2026-07-02-0243-model-use-config-and-capabilities.md) and the Agent Run model-selection transcript event detail in [AI SDK-backed Model Provider Protocols and Agent Run transcript cursors](./2026-07-03-2207-ai-sdk-model-provider-and-agent-run-transcript.md).
