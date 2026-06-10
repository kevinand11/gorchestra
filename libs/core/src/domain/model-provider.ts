import { v, type PipeOutput } from 'valleyed'

import { archivePeriodPipe, auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'

export const modelProviderProtocolPipe = v.in(['anthropic-messages', 'openai-responses', 'openai-completions', 'google-generative-ai'])
export type ModelProviderProtocol = PipeOutput<typeof modelProviderProtocolPipe>

export const modelProviderBaseUrlPipe = nonEmptyTrimmedStringPipe
	.pipe((value) => value.replace(/\/+$/, ''))
	.pipe(
		// fallow-ignore-next-line complexity
		v.custom((value) => {
			if (!URL.canParse(value)) return false
			const url = new URL(value)
			const hostname = url.hostname.toLowerCase()
			return url.protocol === 'https:' || (url.protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1'))
		}, 'Expected an https URL, or an http localhost URL.'),
	)

export const modelProviderApiKeyAuthPipe = v.object({ type: v.eq('apiKey'), secretId: idPipe })
export type ModelProviderApiKeyAuth = PipeOutput<typeof modelProviderApiKeyAuthPipe>

export const modelProviderAuthPipe = v.discriminate((value) => value.type, {
	apiKey: modelProviderApiKeyAuthPipe,
})
export type ModelProviderAuth = PipeOutput<typeof modelProviderAuthPipe>

export const modelProviderHeaderNamePipe = nonEmptyTrimmedStringPipe.pipe(
	v.custom<string>((value) => /^[A-Za-z0-9-]+$/.test(value), 'Expected an HTTP header name.'),
)
export const modelProviderHeaderPipe = v.object({ name: modelProviderHeaderNamePipe, valueSecretId: idPipe })
export type ModelProviderHeader = PipeOutput<typeof modelProviderHeaderPipe>

export const modelProviderHeadersPipe = v.array(modelProviderHeaderPipe).pipe(
	v.custom((headers) => {
		const seen = new Set<string>()

		for (const header of headers) {
			const normalized = header.name.toLowerCase()
			if (seen.has(normalized)) {
				return false
			}
			seen.add(normalized)
		}

		return true
	}, 'Expected Model Provider header names to be unique case-insensitively.'),
)

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
