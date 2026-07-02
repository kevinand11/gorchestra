import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { CreateModelProviderInput, ModelProviderHeader, ModelProviderProtocolType } from '../composables/useServerApi'

export type ModelProviderFormModel = CreateModelProviderInput

type ModelProviderFormFields = {
	name: string
	protocol: ModelProviderProtocolType
	baseUrl: string
	authSecretId: string
	headers: ModelProviderHeader[]
}

const modelProviderNamePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a Model Provider name'))
const modelProviderBaseUrlPipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a base URL'))
const modelProviderProtocolPipe = v.in(['anthropic-messages', 'openai-responses', 'openai-completions', 'google-generative-ai'] as const)
const modelProviderHeadersPipe = v.array(
	v.object({
		name: v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a header name')),
		valueSecretId: v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Select a header Secret')),
	}),
)

export class ModelProviderFormDraft extends FormDraft<ModelProviderFormModel, ModelProviderFormModel, ModelProviderFormFields> {
	protected readonly rules = {
		name: modelProviderNamePipe,
		protocol: modelProviderProtocolPipe,
		baseUrl: modelProviderBaseUrlPipe,
		authSecretId: v.string().pipe(v.asTrimmed()),
		headers: modelProviderHeadersPipe,
	}

	constructor(protocol: ModelProviderProtocolType = 'openai-responses') {
		super({ name: '', protocol, baseUrl: '', authSecretId: '', headers: [] })
	}

	protected model = (): ModelProviderFormModel => ({
		name: this.name,
		protocol: { type: this.protocol },
		baseUrl: this.baseUrl,
		auth: this.authSecretId.length === 0 ? null : { type: 'apiKey', secretId: this.authSecretId },
		headers: this.headers,
	})

	protected load = (entity: ModelProviderFormModel): void => {
		this.name = entity.name
		this.protocol = entity.protocol.type
		this.baseUrl = entity.baseUrl
		this.authSecretId = entity.auth?.secretId ?? ''
		this.headers = entity.headers
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ModelProviderFormDraft', () => {
		it('models provider creation input with trimmed fields and Secret-backed auth', () => {
			const factory = new ModelProviderFormDraft()

			factory.name = '  OpenAI  '
			factory.baseUrl = '  https://api.openai.com/v1  '
			factory.authSecretId = ' secret-1 '
			factory.headers = [{ name: ' X-Team ', valueSecretId: ' secret-2 ' }]

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				name: 'OpenAI',
				protocol: { type: 'openai-responses' },
				baseUrl: 'https://api.openai.com/v1',
				auth: { type: 'apiKey', secretId: 'secret-1' },
				headers: [{ name: 'X-Team', valueSecretId: 'secret-2' }],
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
