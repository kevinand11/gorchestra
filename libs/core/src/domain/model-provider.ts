import { v, type PipeOutput } from 'valleyed'

import { archivePeriodPipe, auditStampPipe, idPipe, jsonObjectPipe, nonEmptyTrimmedStringPipe, type JsonObject } from './commons'
import { listedModelPipe, positiveModelThinkingLevelPipe } from './model'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'

export const modelProviderProtocolPipe = v.in(['openai-responses', 'openai-chat-completions', 'anthropic-messages', 'google-generative-ai'])
export type ModelProviderProtocol = PipeOutput<typeof modelProviderProtocolPipe>
export type ModelProviderProtocolType = ModelProviderProtocol

export const modelProviderBaseUrlPipe = nonEmptyTrimmedStringPipe
	.pipe((value) => value.replace(/\/+$/, ''))
	.pipe(v.custom(isAllowedModelProviderBaseUrl, 'Expected an https URL, or an http localhost URL.'))

function isAllowedModelProviderBaseUrl(value: string): boolean {
	return URL.canParse(value) && isAllowedModelProviderUrl(new URL(value))
}

function isAllowedModelProviderUrl(url: URL): boolean {
	return url.protocol === 'https:' || isLocalHttpUrl(url)
}

function isLocalHttpUrl(url: URL): boolean {
	return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname.toLowerCase())
}

export const builtInModelProviderSourcePipe = v.discriminate((value) => value.type, {
	'openai-responses': v.object({ type: v.eq('openai-responses') }),
	anthropic: v.object({ type: v.eq('anthropic') }),
	google: v.object({ type: v.eq('google') }),
	groq: v.object({ type: v.eq('groq') }),
})
export type BuiltInModelProviderSource = PipeOutput<typeof builtInModelProviderSourcePipe>

export const customHostedModelProviderSourcePipe = v.object({
	type: v.eq('custom-hosted'),
	protocol: modelProviderProtocolPipe,
	baseUrl: modelProviderBaseUrlPipe,
})
export type CustomHostedModelProviderSource = PipeOutput<typeof customHostedModelProviderSourcePipe>

export const modelProviderSourcePipe = v.discriminate((value) => value.type, {
	'openai-responses': v.object({ type: v.eq('openai-responses') }),
	anthropic: v.object({ type: v.eq('anthropic') }),
	google: v.object({ type: v.eq('google') }),
	groq: v.object({ type: v.eq('groq') }),
	'custom-hosted': customHostedModelProviderSourcePipe,
})
export type ModelProviderSource = PipeOutput<typeof modelProviderSourcePipe>

export function modelProviderProtocolForSource(source: ModelProviderSource): ModelProviderProtocol {
	switch (source.type) {
		case 'openai-responses':
			return 'openai-responses'
		case 'anthropic':
			return 'anthropic-messages'
		case 'google':
			return 'google-generative-ai'
		case 'groq':
			return 'openai-chat-completions'
		case 'custom-hosted':
			return source.protocol
		default:
			throw new Error(`Unexpected Model Provider Source: ${String(source satisfies never)}`)
	}
}

export const modelProviderAccessValuePipe = v.discriminate((value) => value.type, {
	secret: v.object({ type: v.eq('secret'), secretId: idPipe }),
})
export type ModelProviderAccessValue = PipeOutput<typeof modelProviderAccessValuePipe>

export const modelProviderAuthPipe = v.object({ value: modelProviderAccessValuePipe })
export type ModelProviderAuth = PipeOutput<typeof modelProviderAuthPipe>

export const modelProviderHeaderNamePipe = nonEmptyTrimmedStringPipe.pipe(
	v.custom((value) => /^[A-Za-z0-9-]+$/.test(value), 'Expected an HTTP header name.'),
)
export const modelProviderHeaderPipe = v.object({ name: modelProviderHeaderNamePipe, value: modelProviderAccessValuePipe })
export type ModelProviderHeader = PipeOutput<typeof modelProviderHeaderPipe>

export const modelProviderHeadersPipe = v
	.array(modelProviderHeaderPipe)
	.pipe(v.custom((headers) => hasUniqueHeaderNames(headers), 'Expected Model Provider header names to be unique case-insensitively.'))

function hasUniqueHeaderNames(headers: ModelProviderHeader[]): boolean {
	const seen = new Set<string>()

	for (const header of headers) {
		const normalized = header.name.toLowerCase()
		if (seen.has(normalized)) return false
		seen.add(normalized)
	}

	return true
}

export const modelProviderOptionsPipe = jsonObjectPipe
export type ModelProviderOptions = JsonObject

export const modelProviderSchema = coreSchema('model_providers')
	.field('name', nonEmptyTrimmedStringPipe)
	.field('source', modelProviderSourcePipe)
	.field('auth', v.nullable(modelProviderAuthPipe))
	.field('headers', modelProviderHeadersPipe)
	.field('providerOptions', v.nullable(modelProviderOptionsPipe))
	.field('created', auditStampPipe)
	.field('updated', v.nullable(auditStampPipe))
	.field('archivePeriods', v.array(archivePeriodPipe))
	.build()
export const modelProviderPipe = schemaToPipe(modelProviderSchema)
export type ModelProvider = PipeOutput<typeof modelProviderPipe>

export const listedModelProviderPipe = v.object({
	id: idPipe,
	name: nonEmptyTrimmedStringPipe,
	source: modelProviderSourcePipe,
	protocol: modelProviderProtocolPipe,
	auth: v.nullable(modelProviderAuthPipe),
	headers: modelProviderHeadersPipe,
	providerOptions: v.nullable(modelProviderOptionsPipe),
	created: auditStampPipe,
	updated: v.nullable(auditStampPipe),
	archived: v.boolean(),
	configurableThinkingLevels: v.array(positiveModelThinkingLevelPipe),
	models: v.array(listedModelPipe),
})
export type ListedModelProvider = PipeOutput<typeof listedModelProviderPipe>

export const modelProviderSummaryPipe = v.object({
	id: idPipe,
	name: nonEmptyTrimmedStringPipe,
	source: modelProviderSourcePipe,
	protocol: modelProviderProtocolPipe,
	archived: v.boolean(),
	configurableThinkingLevels: v.array(positiveModelThinkingLevelPipe),
})
export type ModelProviderSummary = PipeOutput<typeof modelProviderSummaryPipe>

export const modelDetailsPipe = v.merge(listedModelPipe, v.object({ provider: modelProviderSummaryPipe }))
export type ModelDetails = PipeOutput<typeof modelDetailsPipe>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ModelProvider domain pipes', () => {
		it('rejects duplicate header names after normalization in stored and listed models', () => {
			const headers = [
				{ name: ' X-Team ', value: { type: 'secret' as const, secretId: '01k00000000000000000000040' } },
				{ name: 'x-team', value: { type: 'secret' as const, secretId: '01k00000000000000000000041' } },
			]
			const persisted = {
				id: '01k00000000000000000000030',
				name: 'Provider',
				source: { type: 'openai-responses' as const },
				auth: null,
				headers,
				providerOptions: null,
				created: { origin: 'imported' as const, at: '2026-07-09T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			}

			expect(v.validate(modelProviderPipe, persisted).valid).toBe(false)
			expect(
				v.validate(listedModelProviderPipe, {
					...persisted,
					protocol: 'openai-responses',
					archived: false,
					configurableThinkingLevels: [],
					models: [],
				}).valid,
			).toBe(false)
		})

		it('accepts flat protocol values and rejects legacy object variants', () => {
			expect(v.validate(modelProviderProtocolPipe, 'openai-responses')).toMatchObject({ valid: true })
			expect(v.validate(modelProviderProtocolPipe, { type: 'openai-responses' })).toMatchObject({ valid: false })
		})

		it('derives protocol from source', () => {
			expect(modelProviderProtocolForSource({ type: 'openai-responses' })).toBe('openai-responses')
			expect(modelProviderProtocolForSource({ type: 'anthropic' })).toBe('anthropic-messages')
			expect(modelProviderProtocolForSource({ type: 'google' })).toBe('google-generative-ai')
			expect(modelProviderProtocolForSource({ type: 'groq' })).toBe('openai-chat-completions')
			expect(
				modelProviderProtocolForSource({
					type: 'custom-hosted',
					protocol: 'openai-chat-completions',
					baseUrl: 'https://api.example.com/v1',
				}),
			).toBe('openai-chat-completions')
		})
	})
}
