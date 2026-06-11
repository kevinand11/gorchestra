import { v, type PipeOutput } from 'valleyed'

import { archivePeriodPipe, auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'

export const modelProviderProtocolPipe = v.in(['anthropic-messages', 'openai-responses', 'openai-completions', 'google-generative-ai'])
export type ModelProviderProtocol = PipeOutput<typeof modelProviderProtocolPipe>

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

export const modelProviderApiKeyAuthPipe = v.object({ type: v.eq('apiKey'), secretId: idPipe })
export type ModelProviderApiKeyAuth = PipeOutput<typeof modelProviderApiKeyAuthPipe>

export const modelProviderAuthPipe = v.discriminate((value) => value.type, {
	apiKey: modelProviderApiKeyAuthPipe,
})
export type ModelProviderAuth = PipeOutput<typeof modelProviderAuthPipe>

export const modelProviderHeaderNamePipe = nonEmptyTrimmedStringPipe.pipe(
	v.custom((value) => /^[A-Za-z0-9-]+$/.test(value), 'Expected an HTTP header name.'),
)
export const modelProviderHeaderPipe = v.object({ name: modelProviderHeaderNamePipe, valueSecretId: idPipe })
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

export const modelProviderPipe = v.object({
	id: idPipe,
	name: nonEmptyTrimmedStringPipe,
	protocol: modelProviderProtocolPipe,
	baseUrl: nonEmptyTrimmedStringPipe,
	auth: v.nullable(modelProviderAuthPipe),
	headers: v.array(modelProviderHeaderPipe),
	created: auditStampPipe,
	updated: v.nullable(auditStampPipe),
	archivePeriods: v.array(archivePeriodPipe),
})
export type ModelProvider = PipeOutput<typeof modelProviderPipe>
