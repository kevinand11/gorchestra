# Source-owned Model Provider identity and provider options

Core Model Providers store one immutable Model Provider Source rather than a separate source/protocol pair. Built-in sources are protocol-bound by construction: OpenAI Responses uses `openai-responses`, Anthropic uses `anthropic-messages`, Google uses `google-generative-ai`, and Groq uses `openai-chat-completions`. Custom-hosted sources carry the explicit base URL and the flat Model Provider Protocol string they implement. Read models may expose the derived protocol for display, filtering, and thinking-level validation, but stored Model Provider facts do not duplicate it. We chose source-owned protocol derivation to avoid invalid provider/protocol combinations and to leave each built-in source variant room for future source-specific settings without reshaping the field.

Model Provider Source is immutable after creation, including a custom-hosted source's base URL and protocol. Changing from one provider adapter, endpoint, or protocol to another requires creating a new Model Provider and archiving the old one. This preserves the meaning of existing child Models, provider-facing model identifiers, pricing, capabilities, Secret references, and historical transcript interpretation.

Model Provider standard access and custom headers share one reusable access-value shape. Standard auth is `auth: { value } | null`, and each header stores `{ name, value }`, where the current access value variant is a Secret reference. Core deliberately does not store auth scheme variants such as API key versus bearer token yet; concrete provider resolvers know how to pass the standard access slot to their AI SDK provider factory, while the shared value shape can later grow for OAuth or rotating access lifecycles.

Model Providers and Models both store optional un-namespaced `providerOptions` JSON objects. Runtime language-model resolution merges Core defaults first, Model Provider options second, and Model options last, so explicit user configuration overrides Core defaults and model-local options override provider-level options. Core then wraps the merged object under the AI SDK provider namespace, such as `openai`, `anthropic`, `google`, `groq`, or the stable custom-hosted OpenAI-compatible namespace `gorchestraCustomHosted`. Provider options remain opaque to Core except for JSON-object validation; they can include advanced provider-specific settings and may override Core's generic AI SDK `reasoning` option when the AI SDK provider gives provider-specific options precedence.

Because this is still pre-v1, Core storage and API shapes move directly to the new forms without compatibility inputs or storage migrations. This ADR supersedes the earlier provider-shape detail in `2026-07-02-0243-model-use-config-and-capabilities.md` that described Model Provider Protocol as a discriminated variant stored directly on the Model Provider; the Model Use Config and Model capability decisions in that ADR remain in force.

## Consequences

- Model Provider Protocol is a flat Core string union: `openai-responses`, `openai-chat-completions`, `anthropic-messages`, and `google-generative-ai`.
- `openai-completions` remains unsupported because it is the legacy prompt/completions API shape and does not fit Gorchestra's message/tool Agent Run model.
- Built-in Groq is a Model Provider Source using the `openai-chat-completions` protocol rather than a separate protocol.
- Custom-hosted sources must have a base URL; if there is no custom base URL, the provider should be represented as a built-in source.
- Core provider resolution depends on the AI SDK Groq and OpenAI-compatible packages in addition to the existing OpenAI, Anthropic, Google, and AI SDK core packages.
- Model Preflight, Secret References, Delivery preflight, and Agent Run model resolution traverse the shared access-value shape rather than auth/header-specific Secret fields.
- Read models expose derived protocol summaries so consumers do not duplicate Core's source-to-protocol logic.
- Documentation and UI should warn users that Secrets, base URLs, headers, provider model ids, tools, and Core thinking selection have dedicated fields even though opaque provider options can technically override some AI SDK behavior.
