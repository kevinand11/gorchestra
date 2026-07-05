# @gorchestra/form-draft

`@gorchestra/form-draft` provides Vue-backed form draft primitives for editable client forms:
reactive fields, Valleyed validation, visible field errors, dirty tracking, reset, entity loading, nested drafts, draft arrays, and submit-model conversion.

## Core rule: model the edited shape

A form draft should mirror how the user edits the form, not just the storage/API object shape.

- Use primitive fields for primitive controls.
- Use a nested `FormDraft` when the UI edits fields inside an object.
- Use `FormDraftArray` when the UI adds/removes/reorders/edits items inside an array.
- Use a plain object or array field only when the UI replaces the whole value atomically.
- A draft's editable field shape may differ from the submit model; use `toModel()` to convert units or reshape values for the server/API contract.

## Field pipes validate visible input only

Field-level Valleyed rules run while the user types. They should not mutate the visible field value.

Avoid live transformers in field rules:

```ts
// Avoid: this trims while the user is typing and can cause input flicker.
const titlePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a title'))
```

Prefer validation-only pipes:

```ts
const titlePipe = v.string().pipe(v.min<string>(1, 'Enter a title'))
```

Keep validators that inspect the raw visible value:

```ts
const emailPipe = v.string().pipe(v.email('Enter a valid email address'))
const otpPipe = v.string().pipe(v.custom((value) => /^\d{6}$/.test(value), 'Enter the six-digit code'))
```

Let server/API/Core boundary pipes perform canonical cleanup such as trimming, set de-duping, or durable-domain normalization.

## Primitive draft example

```ts
import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type ProjectFormModel = { title: string }
type ProjectFormFields = { title: string }

const titlePipe = v.string().pipe(v.min<string>(1, 'Enter a Project title'))

class ProjectFormDraft extends FormDraft<ProjectFormModel, ProjectFormModel, ProjectFormFields> {
	protected readonly rules = { title: titlePipe }

	constructor() {
		super({ title: '' })
	}

	protected model = (): ProjectFormModel => ({ title: this.title })

	protected load = (entity: ProjectFormModel): void => {
		this.title = entity.title
	}
}
```

## Nested object draft example

If the UI edits object fields individually, model that object as its own draft.

```ts
import { FormDraft, nestedFormDraftPipe } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type LimitsModel = { contextWindowTokens: number; maxOutputTokens: number }
type LimitsFields = LimitsModel

class LimitsFormDraft extends FormDraft<LimitsModel, LimitsModel, LimitsFields> {
	protected readonly rules = {
		contextWindowTokens: v.number().pipe(v.int(), v.gte(1)),
		maxOutputTokens: v.number().pipe(v.int(), v.gte(1)),
	}

	constructor() {
		super({ contextWindowTokens: 128000, maxOutputTokens: 16384 })
	}

	protected model = (): LimitsModel => ({
		contextWindowTokens: this.contextWindowTokens,
		maxOutputTokens: this.maxOutputTokens,
	})

	protected load = (entity: LimitsModel): void => {
		this.contextWindowTokens = entity.contextWindowTokens
		this.maxOutputTokens = entity.maxOutputTokens
	}
}

type ModelFormModel = { name: string; limits: LimitsModel }
type ModelFormFields = { name: string; limits: LimitsFormDraft }

class ModelFormDraft extends FormDraft<ModelFormModel, ModelFormModel, ModelFormFields> {
	protected readonly rules = {
		name: v.string().pipe(v.min<string>(1, 'Enter a Model name')),
		limits: nestedFormDraftPipe<LimitsFormDraft>(),
	}

	constructor() {
		super({ name: '', limits: new LimitsFormDraft() })
	}

	protected model = (): ModelFormModel => ({ name: this.name, limits: this.limits.toModel() })

	protected load = (entity: ModelFormModel): void => {
		this.name = entity.name
		this.limits.loadEntity(entity.limits)
	}
}
```

Nested drafts contribute validity and dirty state to their parent through `nestedFormDraftPipe()`. Because nested validation is part of the field pipe, Valleyed wrappers can control it:

```ts
address: v.conditional(nestedFormDraftPipe<AddressFormDraft>(), () => this.hasAddress)
```

## Array draft example

If the UI edits array items, use `FormDraft.array()` with an item draft.

```ts
import { FormDraft, FormDraftArray, nestedFormDraftPipe } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type HeaderModel = { name: string; valueSecretId: string }
type HeaderFields = HeaderModel

class HeaderFormDraft extends FormDraft<HeaderModel, HeaderModel, HeaderFields> {
	protected readonly rules = {
		name: v.string().pipe(v.min<string>(1, 'Enter a header name')),
		valueSecretId: v.string().pipe(v.min<string>(1, 'Select a Secret')),
	}

	constructor() {
		super({ name: '', valueSecretId: '' })
	}

	protected model = (): HeaderModel => ({ name: this.name, valueSecretId: this.valueSecretId })

	protected load = (entity: HeaderModel): void => {
		this.name = entity.name
		this.valueSecretId = entity.valueSecretId
	}
}

type ProviderModel = { headers: HeaderModel[] }
type ProviderFields = { headers: FormDraftArray<HeaderFormDraft> }

class ProviderFormDraft extends FormDraft<ProviderModel, ProviderModel, ProviderFields> {
	protected readonly rules = { headers: v.array(nestedFormDraftPipe<HeaderFormDraft>()) }

	constructor() {
		super({ headers: FormDraft.array(() => new HeaderFormDraft()) })
	}

	protected model = (): ProviderModel => ({ headers: this.headers.toModel() })

	protected load = (entity: ProviderModel): void => {
		this.headers.loadEntity(entity.headers)
	}
}
```

Vue templates can iterate array drafts:

```vue
<div v-for="(header, index) in [...providerForm.headers]" :key="index">
  <UiInput v-model="header.name" />
  <UiSelect v-model="header.valueSecretId" :options="secretOptions" placeholder="Select Secret" />
  <UiButton type="button" @click="providerForm.headers.delete(index)">Remove</UiButton>
</div>

<UiButton type="button" @click="providerForm.headers.add()">Add header</UiButton>
```

## Atomic object or array exception

A plain object or array field is acceptable when the UI replaces the whole value at once.

```ts
type ImportFormFields = {
	importedJson: { version: number; records: unknown[] } | null
}

class ImportFormDraft extends FormDraft<ImportFormFields, ImportFormFields, ImportFormFields> {
	protected readonly rules = {
		importedJson: v.nullable(v.object({ version: v.number(), records: v.array(v.any<unknown>()) })),
	}

	constructor() {
		super({ importedJson: null })
	}

	protected model = (): ImportFormFields => ({ importedJson: this.importedJson })

	protected load = (entity: ImportFormFields): void => {
		this.importedJson = entity.importedJson
	}
}
```

Do not use this pattern when individual nested fields are editable in the form.

## Different draft shape and submit model

A draft may use a user-friendly editable shape and convert in `toModel()`.

```ts
type PricingModel = {
	unit: 'micro-usd-per-million-tokens'
	input: number
	output: number
}

type PricingFields = {
	enabled: boolean
	inputUsdPerMillion: number
	outputUsdPerMillion: number
}

class PricingFormDraft extends FormDraft<PricingModel | null, PricingModel | null, PricingFields> {
	protected readonly rules = {
		enabled: v.boolean(),
		inputUsdPerMillion: v.number().pipe(v.gte(0)),
		outputUsdPerMillion: v.number().pipe(v.gte(0)),
	}

	constructor() {
		super({ enabled: false, inputUsdPerMillion: 0, outputUsdPerMillion: 0 })
	}

	protected model = (): PricingModel | null =>
		this.enabled
			? {
					unit: 'micro-usd-per-million-tokens',
					input: Math.round(this.inputUsdPerMillion * 1_000_000),
					output: Math.round(this.outputUsdPerMillion * 1_000_000),
				}
			: null

	protected load = (entity: PricingModel | null): void => {
		this.enabled = entity !== null
		this.inputUsdPerMillion = entity === null ? 0 : entity.input / 1_000_000
		this.outputUsdPerMillion = entity === null ? 0 : entity.output / 1_000_000
	}
}
```

Use submit-model conversion for shape or unit changes. Do not use field pipes for live cleanup of text while the user types.

## Optional select values

Use explicit `null` for optional single-select fields. Do not encode “none” as an empty string sentinel.

```ts
type ModelUseFields = { modelId: string | null }

const modelIdPipe = v.string().pipe(v.min<string>(1, 'Select a Model'))

const rules = {
	modelId: v.nullable(modelIdPipe),
}

const options = [
	{ value: null, label: 'Use default' },
	{ value: 'model-1', label: 'GPT 4.1' },
]
```

## Select drafts with async options

Use `FormDraftSelect` for single-select controls whose selectable values load asynchronously or whose current value must be checked against an allowed list.

```ts
import { FormDraftSelect } from '@gorchestra/form-draft'
import { v } from 'valleyed'

const modelSelect = new FormDraftSelect<string>({
	initialValue: '',
	pipe: v.string().pipe(v.min<string>(1, 'Select a Model')),
})

modelSelect.clearOptions() // options unknown; membership validation is skipped
modelSelect.setOptions(['model-1', 'model-2']) // options known; selected value must be present
modelSelect.value = 'model-1'
```

Use `FormDraftMultiSelect` for array-valued multi-select controls.

```ts
import { FormDraftMultiSelect } from '@gorchestra/form-draft'
import { v } from 'valleyed'

const selectedTags = new FormDraftMultiSelect<string>({
	initialValue: [],
	pipe: v.array(v.string()).pipe(v.min<string>(1, 'Select at least one option')),
})

selectedTags.setOptions(['bug', 'feature', 'docs'])
selectedTags.value = ['feature']
```

`setOptions(values)` means options are loaded and known. `clearOptions()` means options are unknown, so option-membership validation is skipped until options load. `resetOptions()` restores constructor `initialOptions` when provided, or returns to unknown options when no initial options were provided. Option-membership validation is chained after the required caller `pipe`, and uses `differ.equal`, so object-valued options are compared structurally rather than by object identity.

When a select is embedded in another `FormDraft`, parent validity, dirty state, reset behavior, and first child error propagation work through `nestedFormDraftPipe()` like other nested drafts:

```ts
import { FormDraft, FormDraftSelect, nestedFormDraftPipe } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type ModelUse = { modelId: string | null }

class ModelUseDraft extends FormDraft<ModelUse, string | null, { modelId: FormDraftSelect<string | null> }> {
	protected readonly rules = { modelId: nestedFormDraftPipe<FormDraftSelect<string | null>>() }

	constructor() {
		super({
			modelId: new FormDraftSelect<string | null>({
				initialValue: null,
				pipe: v.nullable(v.string()),
			}),
		})
	}

	protected model = () => this.modelId.toModel()

	protected load = (entity: ModelUse): void => {
		this.modelId.loadEntity(entity.modelId)
	}
}
```
