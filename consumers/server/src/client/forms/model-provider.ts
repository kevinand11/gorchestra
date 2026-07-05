import { FormDraft, nestedFormDraftPipe, type FormDraftArray } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type {
	CreateModelProviderInput,
	ModelProviderHeader,
	ModelProviderProtocolType,
	ModelProviderSource,
} from '../composables/core/server-api'
import { isJsonObjectText, providerOptionsFromText, providerOptionsText } from '../utils/provider-options-text'

export type ModelProviderFormModel = CreateModelProviderInput

export type ModelProviderSourceType = ModelProviderSource['type']

type ModelProviderHeaderFormFields = {
	name: string
	valueSecretId: string
}

type ModelProviderFormFields = {
	name: string
	sourceType: ModelProviderSourceType
	customProtocol: ModelProviderProtocolType
	customBaseUrl: string
	authSecretId: string | null
	headers: FormDraftArray<ModelProviderHeaderFormDraft>
	providerOptionsText: string
}

const modelProviderNamePipe = v.string().pipe(v.min<string>(1, 'Enter a Model Provider name'))
const modelProviderSourceTypePipe = v.in(['openai-responses', 'anthropic', 'google', 'groq', 'custom-hosted'])
const modelProviderProtocolPipe = v.in(['openai-responses', 'openai-chat-completions', 'anthropic-messages', 'google-generative-ai'])
const modelProviderAuthSecretIdPipe = v.nullable(v.string().pipe(v.min<string>(1, 'Select an auth Secret')))
const modelProviderHeaderNamePipe = v.string().pipe(v.min<string>(1, 'Enter a header name'))
const modelProviderHeaderSecretIdPipe = v.string().pipe(v.min<string>(1, 'Select a header Secret'))
const providerOptionsTextPipe = v.string().pipe(v.custom(isJsonObjectText, 'Enter a JSON object or leave empty'))

export class ModelProviderHeaderFormDraft extends FormDraft<ModelProviderHeader, ModelProviderHeader, ModelProviderHeaderFormFields> {
	protected readonly rules = {
		name: modelProviderHeaderNamePipe,
		valueSecretId: modelProviderHeaderSecretIdPipe,
	}

	constructor() {
		super({ name: '', valueSecretId: '' })
	}

	protected model = (): ModelProviderHeader => ({ name: this.name, value: { type: 'secret', secretId: this.valueSecretId } })

	protected load = (entity: ModelProviderHeader): void => {
		this.name = entity.name
		this.valueSecretId = entity.value.secretId
	}
}

export class ModelProviderFormDraft extends FormDraft<ModelProviderFormModel, ModelProviderFormModel, ModelProviderFormFields> {
	protected override readonly onSet = {
		sourceType: () => this.set('customBaseUrl', this.customBaseUrl),
	}

	protected readonly rules = {
		name: modelProviderNamePipe,
		sourceType: modelProviderSourceTypePipe,
		customProtocol: modelProviderProtocolPipe,
		customBaseUrl: v
			.string()
			.pipe(v.custom<string>((value) => this.sourceType !== 'custom-hosted' || value.trim().length > 0, 'Enter a base URL')),
		authSecretId: modelProviderAuthSecretIdPipe,
		headers: v.array(nestedFormDraftPipe<ModelProviderHeaderFormDraft>()),
		providerOptionsText: providerOptionsTextPipe,
	}

	constructor(sourceType: ModelProviderSourceType = 'openai-responses') {
		super({
			name: '',
			sourceType,
			customProtocol: 'openai-chat-completions',
			customBaseUrl: '',
			authSecretId: null,
			headers: FormDraft.array(() => new ModelProviderHeaderFormDraft()),
			providerOptionsText: '',
		})
		this.sourceType = sourceType
	}

	protected model = (): ModelProviderFormModel => ({
		name: this.name,
		source: this.sourceModel(),
		auth: this.authSecretId === null ? null : { value: { type: 'secret', secretId: this.authSecretId } },
		headers: this.headers.toModel(),
		providerOptions: providerOptionsFromText(this.providerOptionsText),
	})

	protected load = (entity: ModelProviderFormModel): void => {
		this.name = entity.name
		this.loadSource(entity.source)
		this.authSecretId = entity.auth?.value.secretId ?? null
		this.headers.loadEntity(entity.headers)
		this.providerOptionsText = providerOptionsText(entity.providerOptions)
	}

	private sourceModel(): ModelProviderSource {
		switch (this.sourceType) {
			case 'openai-responses':
				return { type: 'openai-responses' }
			case 'anthropic':
				return { type: 'anthropic' }
			case 'google':
				return { type: 'google' }
			case 'groq':
				return { type: 'groq' }
			case 'custom-hosted':
				return { type: 'custom-hosted', protocol: this.customProtocol, baseUrl: this.customBaseUrl }
			default:
				throw new Error(`Unexpected Model Provider Source type: ${String(this.sourceType satisfies never)}`)
		}
	}

	private loadSource(source: ModelProviderSource): void {
		this.sourceType = source.type
		if (source.type === 'custom-hosted') {
			this.customProtocol = source.protocol
			this.customBaseUrl = source.baseUrl
		} else {
			this.customProtocol = 'openai-chat-completions'
			this.customBaseUrl = ''
		}
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ModelProviderFormDraft', () => {
		it('models provider creation input with Secret-backed auth and nested headers', () => {
			const factory = new ModelProviderFormDraft()
			const header = factory.headers.add()

			factory.name = '  OpenAI  '
			factory.authSecretId = 'secret-1'
			factory.providerOptionsText = '{"store":true}'
			header.name = ' X-Team '
			header.valueSecretId = 'secret-2'

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				name: '  OpenAI  ',
				source: { type: 'openai-responses' },
				auth: { value: { type: 'secret', secretId: 'secret-1' } },
				headers: [{ name: ' X-Team ', value: { type: 'secret', secretId: 'secret-2' } }],
				providerOptions: { store: true },
			})
		})

		it('requires a base URL only for custom-hosted sources', () => {
			const factory = new ModelProviderFormDraft('custom-hosted')

			factory.name = 'Custom'
			factory.customBaseUrl = ' '

			expect(factory.valid).toBe(false)
			expect(factory.errors.customBaseUrl).toBe('Enter a base URL')

			factory.customBaseUrl = 'https://api.example.com/v1'

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toMatchObject({
				source: { type: 'custom-hosted', protocol: 'openai-chat-completions', baseUrl: 'https://api.example.com/v1' },
			})
		})

		it('loads existing provider input', () => {
			const factory = new ModelProviderFormDraft()

			factory.loadEntity({
				name: 'Provider',
				source: { type: 'google' },
				auth: null,
				headers: [],
				providerOptions: { structuredOutputs: false },
			})

			expect(factory.toModel()).toEqual({
				name: 'Provider',
				source: { type: 'google' },
				auth: null,
				headers: [],
				providerOptions: { structuredOutputs: false },
			})
		})
	})
}
