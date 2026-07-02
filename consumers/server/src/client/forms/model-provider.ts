import { FormDraft, formDraftPipe, type FormDraftArray } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { CreateModelProviderInput, ModelProviderHeader, ModelProviderProtocolType } from '../composables/core/server-api'

export type ModelProviderFormModel = CreateModelProviderInput

type ModelProviderHeaderFormFields = {
	name: string
	valueSecretId: string
}

type ModelProviderFormFields = {
	name: string
	protocol: ModelProviderProtocolType
	baseUrl: string
	authSecretId: string | null
	headers: FormDraftArray<ModelProviderHeaderFormDraft>
}

const modelProviderNamePipe = v.string().pipe(v.min<string>(1, 'Enter a Model Provider name'))
const modelProviderBaseUrlPipe = v.string().pipe(v.min<string>(1, 'Enter a base URL'))
const modelProviderProtocolPipe = v.in(['anthropic-messages', 'openai-responses', 'openai-completions', 'google-generative-ai'])
const modelProviderAuthSecretIdPipe = v.nullable(v.string().pipe(v.min<string>(1, 'Select an auth Secret')))
const modelProviderHeaderNamePipe = v.string().pipe(v.min<string>(1, 'Enter a header name'))
const modelProviderHeaderSecretIdPipe = v.string().pipe(v.min<string>(1, 'Select a header Secret'))

export class ModelProviderHeaderFormDraft extends FormDraft<ModelProviderHeader, ModelProviderHeader, ModelProviderHeaderFormFields> {
	protected readonly rules = {
		name: modelProviderHeaderNamePipe,
		valueSecretId: modelProviderHeaderSecretIdPipe,
	}

	constructor() {
		super({ name: '', valueSecretId: '' })
	}

	protected model = (): ModelProviderHeader => ({ name: this.name, valueSecretId: this.valueSecretId })

	protected load = (entity: ModelProviderHeader): void => {
		this.name = entity.name
		this.valueSecretId = entity.valueSecretId
	}
}

export class ModelProviderFormDraft extends FormDraft<ModelProviderFormModel, ModelProviderFormModel, ModelProviderFormFields> {
	protected readonly rules = {
		name: modelProviderNamePipe,
		protocol: modelProviderProtocolPipe,
		baseUrl: modelProviderBaseUrlPipe,
		authSecretId: modelProviderAuthSecretIdPipe,
		headers: formDraftPipe<FormDraftArray<ModelProviderHeaderFormDraft>>(),
	}

	constructor(protocol: ModelProviderProtocolType = 'openai-responses') {
		super({ name: '', protocol, baseUrl: '', authSecretId: null, headers: FormDraft.asArray(() => new ModelProviderHeaderFormDraft()) })
	}

	protected model = (): ModelProviderFormModel => ({
		name: this.name,
		protocol: { type: this.protocol },
		baseUrl: this.baseUrl,
		auth: this.authSecretId === null ? null : { type: 'apiKey', secretId: this.authSecretId },
		headers: this.headers.toModel(),
	})

	protected load = (entity: ModelProviderFormModel): void => {
		this.name = entity.name
		this.protocol = entity.protocol.type
		this.baseUrl = entity.baseUrl
		this.authSecretId = entity.auth?.secretId ?? null
		this.headers.loadEntity(entity.headers)
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ModelProviderFormDraft', () => {
		it('models provider creation input with Secret-backed auth and nested headers', () => {
			const factory = new ModelProviderFormDraft()
			const header = factory.headers.add()

			factory.name = '  OpenAI  '
			factory.baseUrl = '  https://api.openai.com/v1  '
			factory.authSecretId = 'secret-1'
			header.name = ' X-Team '
			header.valueSecretId = 'secret-2'

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				name: '  OpenAI  ',
				protocol: { type: 'openai-responses' },
				baseUrl: '  https://api.openai.com/v1  ',
				auth: { type: 'apiKey', secretId: 'secret-1' },
				headers: [{ name: ' X-Team ', valueSecretId: 'secret-2' }],
			})
		})

		it('does not prefill a base URL', () => {
			const factory = new ModelProviderFormDraft('anthropic-messages')

			expect(factory.protocol).toBe('anthropic-messages')
			expect(factory.baseUrl).toBe('')
		})

		it('loads existing provider input', () => {
			const factory = new ModelProviderFormDraft()

			factory.loadEntity({
				name: 'Provider',
				protocol: { type: 'google-generative-ai' },
				baseUrl: 'https://generativelanguage.googleapis.com',
				auth: null,
				headers: [],
			})

			expect(factory.toModel()).toEqual({
				name: 'Provider',
				protocol: { type: 'google-generative-ai' },
				baseUrl: 'https://generativelanguage.googleapis.com',
				auth: null,
				headers: [],
			})
		})
	})
}
