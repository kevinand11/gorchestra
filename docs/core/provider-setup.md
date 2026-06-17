# Core Provider Setup

Core owns provider behavior for Source Control Providers and Model Provider Protocols. Consumers configure provider records and provide Core Services for Secret-at-rest protection and plaintext Secret resolution; concrete Core providers receive resolved values and perform the external SDK call.

See also:

- `CONTEXT.md` for Core provider and preflight language.
- `adr/2026-06-09-1523-core-owned-provider-behavior.md` for the Core/Consumer boundary.
- `adr/2026-06-09-1521-validate-every-core-boundary-before-use.md` for safe provider failure handling.

## Source Control Provider setup

### GitHub

Repository provider config uses the `github` Source Control Provider.

Typical setup:

1. Store a GitHub personal access token as a Core Secret.
2. Configure a Repository with the GitHub provider, owner/name target, and the Secret reference used for provider access.
3. Run Repository Preflight before relying on the Repository for Source Control Project work.

Repository Preflight is observational. It verifies stored Repository facts, active provider access Secret references, plaintext Secret resolution, and provider repository reachability. It returns safe Validation Evidence and does not write Portfolio lifecycle facts.

## Model Provider Protocol setup

Model Providers define a stable protocol, base URL, optional API-key auth Secret, and optional custom header Secrets. Models under a provider store the provider-facing model identifier.

Supported Model Provider Protocols:

| Protocol               | Typical base URL                            | Access                                                                 | Reachability check                    |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- |
| `openai-responses`     | `https://api.openai.com/v1`                 | API key Secret, optional header Secrets such as `OpenAI-Organization`  | OpenAI model metadata retrieval       |
| `openai-completions`   | `https://api.openai.com/v1`                 | API key Secret, optional header Secrets such as `OpenAI-Organization`  | OpenAI model metadata retrieval       |
| `anthropic-messages`   | `https://api.anthropic.com`                 | API key Secret, optional header Secrets such as Anthropic beta headers | Anthropic model metadata retrieval    |
| `google-generative-ai` | `https://generativelanguage.googleapis.com` | API key Secret, optional Google header Secrets                         | Google GenAI model metadata retrieval |

Model Preflight is observational. It checks stored Model and Model Provider facts, archived state, active provider access Secret references, plaintext Secret resolution, and provider model reachability. It returns safe Validation Evidence and does not perform text generation or write Portfolio lifecycle facts.

### Example provider records

OpenAI Responses:

```ts
{
	name: 'OpenAI',
	protocol: 'openai-responses',
	baseUrl: 'https://api.openai.com/v1',
	auth: { type: 'apiKey', secretId: 'secret-openai-api-key' },
	headers: [],
}
```

Anthropic Messages:

```ts
{
	name: 'Anthropic',
	protocol: 'anthropic-messages',
	baseUrl: 'https://api.anthropic.com',
	auth: { type: 'apiKey', secretId: 'secret-anthropic-api-key' },
	headers: [],
}
```

Google Generative AI:

```ts
{
	name: 'Google Generative AI',
	protocol: 'google-generative-ai',
	baseUrl: 'https://generativelanguage.googleapis.com',
	auth: { type: 'apiKey', secretId: 'secret-gemini-api-key' },
	headers: [],
}
```

Example Models under those providers:

```ts
{ providerId: 'model-provider-openai', name: 'GPT 4o Mini', providerModelId: 'gpt-4o-mini' }
{ providerId: 'model-provider-anthropic', name: 'Claude Sonnet', providerModelId: 'claude-sonnet-4-5-20250929' }
{ providerId: 'model-provider-google', name: 'Gemini Flash', providerModelId: 'gemini-2.5-flash' }
```

## Writing provider verification tests

A provider verification test should arrange Core the same way a Consumer would:

1. Open Core with an already-configured CoreStorage Equipped Repo plus Secret and sandbox Core Services.
2. Store a Secret whose protected value reference points to the deployment's secret store entry.
3. Configure the provider record with the Secret reference and any header Secret references.
4. Configure the Repository or Model record using the provider-facing identifier.
5. Make the Secret Core Service resolve requested Secret IDs to plaintext values only inside the test process.
6. Call the relevant preflight operation and assert on safe Validation Evidence.

For Model Provider Protocol tests, assert that success returns Model Preflight Validation Evidence with `passed: true`; for expected provider failures, assert on the safe summary/reason rather than raw SDK exceptions. Avoid tests that depend on generation output, token usage, or mutable provider-side state. Prefer model or repository metadata endpoints because preflight should prove reachability with minimal side effects.

Minimal Model Preflight test shape:

```ts
const services = createConsumerLikeCoreServices({
	resolveSecretValues: async ({ secretIds }) => Object.fromEntries(secretIds.map((id) => [id, plaintextValueFor(id)])),
})
const opened = openCore(services)
if (!opened.ok) throw new Error('Core did not open')
const core = opened.value

const secret = await core.commands.createSecret({ name: 'Provider API key', valueRef: 'protected-ref' }, context)
if (!secret.ok) throw new Error('Secret was not created')

const provider = await core.commands.createModelProvider(
	{
		name: 'Provider',
		protocol: 'anthropic-messages',
		baseUrl: 'https://api.anthropic.com',
		auth: { type: 'apiKey', secretId: secret.value.id },
		headers: [],
	},
	context,
)
if (!provider.ok) throw new Error('Model Provider was not created')

const model = await core.commands.createModel(
	{ providerId: provider.value.id, name: 'Claude Sonnet', providerModelId: 'claude-sonnet-4-5-20250929' },
	context,
)

if (!model.ok) throw new Error('Model was not created')

const evidence = await core.commands.preflightModel({ modelId: model.value.id }, context)
```

Keep plaintext credentials out of stored Core records, test fixtures, snapshots, logs, and assertions. Core Secret records store protected value references only; plaintext appears only transiently through `resolveSecretValues`.
