# Model use config and Model capability metadata

Core Models store provider-facing capability metadata such as supported inputs, context and output token limits, reasoning support, and optional pricing, while scoped configuration stores atomic Model Use Config values that select a Model and Model Thinking Level together for an Agent Run purpose. We chose atomic Model Use Config over independently inherited model IDs and thinking levels so Core never represents a half-selected or incompatible model/thinking pair; narrower config either overrides the whole pair or inherits the whole pair.

Model reasoning metadata uses a nullable full thinking-level map: `null` means reasoning support is unknown and Core should not try reasoning, while a non-null map records provider values for configured canonical Model Thinking Levels and `null` entries for unavailable levels. An effective `off` thinking level with unknown reasoning omits provider reasoning parameters; non-off levels require a configured provider value, and configured `off` can carry an explicit provider off value.

Agent Run model selection remains a single `agent-run-model-selected` transcript event containing only the selected `modelId`, selected `thinkingLevel`, and authorization. Core deliberately does not snapshot Model Provider IDs or protocol variants in the event for now because they are inferable from the selected Model and current immutable Model Provider; protocol snapshotting can be added later if replay/debug needs justify storing redundant provider behavior metadata.

Model Provider Protocol is a discriminated variant rather than a string so future protocol-specific options have a stable home, but protocol options are deferred until there is a concrete provider compatibility need. Because this is pre-v1, Core storage and API shapes move directly to the new forms without compatibility inputs or storage migrations.

## Consequences

- Portfolio Config owns the non-null default Model Use Config; Project, Plan, and Delivery config purpose fields are nullable atomic overrides.
- Delivery Config covers execution and revision-execution Model Use Config only; revision planning should get immutable creation-time config, mirroring Plan creation, instead of using Delivery Config.
- Model `maxOutputTokens` becomes the default provider output cap, while `contextWindowTokens` is metadata until provider-aware token counting and compaction are implemented.
- When Model pricing is configured, Agent Run usage records computed integer micro-USD costs; when pricing is absent, usage cost remains `null`.
