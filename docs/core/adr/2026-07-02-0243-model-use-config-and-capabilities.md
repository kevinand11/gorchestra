# Model use config and Model capability metadata

Superseded in part by [Agent Run Profiles and Project-scoped Delivery work config](./2026-07-04-1328-agent-run-profiles-and-delivery-work-config.md), which replaces scoped Model Use Config inheritance with Agent Run Profiles, Project-scoped Delivery work defaults, and Agent Run Model Use Overrides.

Core Models store provider-facing capability metadata such as supported inputs, context and output token limits, configured positive thinking support, and optional pricing, while scoped configuration stores atomic Model Use Config values that select a Model and Model Thinking Level together for an Agent Run purpose. We chose atomic Model Use Config over independently inherited model IDs and thinking levels so Core never represents a half-selected or incompatible model/thinking pair; narrower config either overrides the whole pair or inherits the whole pair.

Model thinking metadata uses `capabilities.thinking: { supportedLevels } | null`. `supportedLevels` stores only positive Core Model Thinking Levels (`minimal`, `low`, `medium`, `high`, `xhigh`) that the Model supports; `none` is not stored because it is an implicit best-effort explicit-disable request and is always selectable. Core validates configured positive support against the Model Provider Protocol so protocol-impossible choices, such as `xhigh` for Google Generative AI, do not become selectable or runnable. Runtime `null` thinking still means Core sends no AI SDK reasoning option.

Agent Run model selection remains a single `agent-run-model-selected` transcript event containing only the selected `modelId`, selected `thinkingLevel`, and authorization. Core deliberately does not snapshot Model Provider IDs or protocol variants in the event for now because they are inferable from the selected Model and current immutable Model Provider; protocol snapshotting can be added later if replay/debug needs justify storing redundant provider behavior metadata.

Model Provider Protocol was originally described here as a discriminated variant stored directly on Model Provider records. That provider-shape detail is superseded by `2026-07-04-1208-source-owned-model-provider-identity-and-provider-options.md`: Model Providers now store an immutable Model Provider Source, built-in sources derive a flat protocol by construction, and custom-hosted sources declare the flat protocol they implement. Because this is pre-v1, Core storage and API shapes continue to move directly to new forms without compatibility inputs or storage migrations.

## Consequences

- Portfolio Config owns the non-null default Model Use Config; Project, Plan, and Delivery config purpose fields are nullable atomic overrides.
- Delivery Config covers execution and revision-execution Model Use Config only; revision planning should get immutable creation-time config, mirroring Plan creation, instead of using Delivery Config.
- Model `maxOutputTokens` becomes the default provider output cap, while `contextWindowTokens` is metadata until provider-aware token counting and compaction are implemented.
- Model use selectors expose the selected Model's derived available Model Thinking Levels rather than the full Core level list.
- When Model pricing is configured, Agent Run usage records computed integer micro-USD costs; when pricing is absent, usage cost remains `null`.
