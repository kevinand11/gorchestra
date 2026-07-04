# Core Provider Setup

Core owns provider behavior for Source Control Providers, Model Provider Sources, and Model Provider Protocols. Consumers configure provider records and provide Core Services for Secret-at-rest protection and plaintext Secret resolution; concrete Core providers receive resolved values and perform the external SDK or AI SDK call.

See also:

- `CONTEXT.md` for Core provider and preflight language.
- `adr/2026-06-09-1523-core-owned-provider-behavior.md` for the Core/Consumer boundary.
- `adr/2026-06-09-1521-validate-every-core-boundary-before-use.md` for safe provider failure handling.
- `adr/2026-07-04-1208-source-owned-model-provider-identity-and-provider-options.md` for Model Provider Source, access value, and provider options decisions.

## Source Control Provider setup

### GitHub

Repository provider config uses the `github` Source Control Provider.

Typical setup:

1. Store a GitHub personal access token as a Core Secret.
2. Configure a Repository with the GitHub provider, owner/name target, and the Secret reference used for provider access.
3. Run Repository Preflight before relying on the Repository for Source Control Project work.

Repository Preflight is observational. It verifies stored Repository facts, active provider access Secret references, plaintext Secret resolution, and provider repository reachability. It returns safe Validation Evidence and does not write Portfolio lifecycle facts, readiness state, or history.

## Model Provider setup

Model Providers define an immutable Model Provider Source, optional Secret-backed standard access, optional Secret-backed custom headers, and optional provider-local AI SDK provider options. Built-in sources use Core-known AI SDK provider adapters and their default endpoints. Custom-hosted sources require an explicit base URL and declare the Model Provider Protocol they implement. Models under a provider store the provider-facing model identifier, optional model-local provider options, and configured positive Model Thinking Levels supported by that Model. `none` is implicit and always selectable.

Supported Model Provider Sources:

| Source type        | Derived protocol          | Endpoint behavior                                                    | Access                                                                 | Reachability check                          |
| ------------------ | ------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| `openai-responses` | `openai-responses`        | Built-in OpenAI Responses AI SDK provider default endpoint           | API key Secret, optional header Secrets such as `OpenAI-Organization`  | Tiny bounded AI SDK `streamText` generation |
| `anthropic`        | `anthropic-messages`      | Built-in Anthropic AI SDK provider default endpoint                  | API key Secret, optional header Secrets such as Anthropic beta headers | Tiny bounded AI SDK `streamText` generation |
| `google`           | `google-generative-ai`    | Built-in Google Generative AI SDK provider default endpoint          | API key Secret, optional Google header Secrets                         | Tiny bounded AI SDK `streamText` generation |
| `groq`             | `openai-chat-completions` | Built-in Groq AI SDK provider default OpenAI-compatible endpoint     | API key Secret, optional Groq header Secrets                           | Tiny bounded AI SDK `streamText` generation |
| `custom-hosted`    | Source-declared protocol  | Explicit source `baseUrl`; used for the protocol the endpoint claims | API key Secret when needed, optional header Secrets                    | Tiny bounded AI SDK `streamText` generation |

Supported Model Provider Protocols are `openai-responses`, `openai-chat-completions`, `anthropic-messages`, and `google-generative-ai`. `openai-completions` is not supported because it is the legacy prompt/completions API shape rather than Gorchestra's message/tool Agent Run model.

Model Preflight is observational. It checks stored Model and Model Provider facts, archived state, configured positive thinking support against the derived Model Provider Protocol, active provider access Secret references, plaintext Secret resolution, and AI SDK-backed provider generation reachability with a tiny bounded no-tool `streamText` probe. It returns safe Validation Evidence and does not write Agent Run Events, Portfolio lifecycle facts, readiness state, or history. The generation output is ignored. Model Preflight sends no AI SDK reasoning option; configured thinking levels are validated as Core metadata rather than exercised through the preflight generation.

Provider options are stored as un-namespaced JSON objects on Model Providers and Models. Runtime resolution merges Core defaults first, Model Provider options second, and Model options last, so explicit user configuration wins over Core defaults and model-local options win over provider-level options. Core then wraps the merged object under the AI SDK provider namespace such as `openai`, `anthropic`, `google`, `groq`, or the stable custom-hosted OpenAI-compatible namespace `gorchestraCustomHosted`. Provider options are for provider-specific generation behavior; Secrets, base URLs, headers, provider model ids, tools, and Core thinking selection belong in their dedicated Core fields. AI SDK provider-specific reasoning options may override Core's generic `reasoning` option when the AI SDK provider gives them precedence.

### Example provider records

OpenAI Responses built-in source:

```ts
{
	name: 'OpenAI',
	source: { type: 'openai-responses' },
	auth: { value: { type: 'secret', secretId: 'secret-openai-api-key' } },
	headers: [],
	providerOptions: null,
}
```

Anthropic built-in source:

```ts
{
	name: 'Anthropic',
	source: { type: 'anthropic' },
	auth: { value: { type: 'secret', secretId: 'secret-anthropic-api-key' } },
	headers: [],
	providerOptions: null,
}
```

Google Generative AI built-in source:

```ts
{
	name: 'Google Generative AI',
	source: { type: 'google' },
	auth: { value: { type: 'secret', secretId: 'secret-gemini-api-key' } },
	headers: [],
	providerOptions: null,
}
```

Groq built-in source with provider-local options:

```ts
{
	name: 'Groq',
	source: { type: 'groq' },
	auth: { value: { type: 'secret', secretId: 'secret-groq-api-key' } },
	headers: [],
	providerOptions: { serviceTier: 'flex', structuredOutputs: false },
}
```

Custom-hosted OpenAI-compatible source with a Secret-backed header:

```ts
{
	name: 'Internal OpenAI-compatible endpoint',
	source: {
		type: 'custom-hosted',
		protocol: 'openai-chat-completions',
		baseUrl: 'https://models.example.internal/v1',
	},
	auth: { value: { type: 'secret', secretId: 'secret-internal-model-api-key' } },
	headers: [{ name: 'X-Team', value: { type: 'secret', secretId: 'secret-provider-team' } }],
	providerOptions: null,
}
```

Example Models under those providers:

```ts
{ providerId: 'model-provider-openai', name: 'GPT 4o Mini', providerModelId: 'gpt-4o-mini', providerOptions: null }
{ providerId: 'model-provider-anthropic', name: 'Claude Sonnet', providerModelId: 'claude-sonnet-4-5-20250929', providerOptions: null }
{ providerId: 'model-provider-google', name: 'Gemini Flash', providerModelId: 'gemini-2.5-flash', providerOptions: null }
{ providerId: 'model-provider-groq', name: 'Groq GPT OSS 120B', providerModelId: 'openai/gpt-oss-120b', providerOptions: { reasoningEffort: 'high' } }
```

## Writing provider verification tests

A provider verification test should arrange Core the same way a Consumer would:

1. Open Core with an already-configured CoreStorage Equipped Repo plus Secret and sandbox Core Services.
2. Store a Secret whose protected value reference points to the deployment's secret store entry.
3. Configure the provider record with the Secret reference and any header Secret references.
4. Configure the Repository or Model record using the provider-facing identifier.
5. Make the Secret Core Service resolve requested Secret value refs to plaintext values only inside the test process.
6. Call the relevant preflight operation and assert on safe Validation Evidence.

For Model Provider Protocol tests, assert that success returns Model Preflight Validation Evidence with `passed: true`; for expected provider failures, assert on the safe summary/reason rather than raw SDK exceptions. Avoid tests that depend on generation output text, token usage, or mutable provider-side state. Model Preflight should use the minimal AI SDK generation probe because AI SDK does not expose a provider-agnostic model metadata existence check.

Minimal Model Preflight test shape:

```ts
const services = createConsumerLikeCoreServices({
	resolveSecretValues: async ({ secrets }) =>
		Object.fromEntries(secrets.map((secret) => [secret.secretId, plaintextValueFor(secret.valueRef)])),
})
const opened = openCore(services)
if (!opened.ok) throw new Error('Core did not open')
const core = opened.value

const secret = await core.commands.createSecret({ name: 'Provider API key', valueRef: 'protected-ref' }, context)
if (!secret.ok) throw new Error('Secret was not created')

const provider = await core.commands.createModelProvider(
	{
		name: 'Provider',
		source: { type: 'anthropic' },
		auth: { value: { type: 'secret', secretId: secret.value.id } },
		headers: [],
		providerOptions: null,
	},
	context,
)
if (!provider.ok) throw new Error('Model Provider was not created')

const model = await core.commands.createModel(
	{ providerId: provider.value.id, name: 'Claude Sonnet', providerModelId: 'claude-sonnet-4-5-20250929', providerOptions: null },
	context,
)

if (!model.ok) throw new Error('Model was not created')

const evidence = await core.commands.preflightModel({ modelId: model.value.id }, context)
```

Keep plaintext credentials out of stored Core records, test fixtures, snapshots, logs, and assertions. Core Secret records store protected value references only; plaintext appears only transiently through `resolveSecretValues`.
