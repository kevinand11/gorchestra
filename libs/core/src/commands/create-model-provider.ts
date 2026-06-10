import { v, type PipeOutput } from 'valleyed'

import {
	auditStamp,
	nextId,
	putRecord,
	secretReferencesFromModelProviderConfig,
	validateActiveSecretReferences,
	withTransaction,
} from './storage-utils'
import { buildCommandHandler } from './utils'
import { nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import {
	modelProviderAuthPipe,
	modelProviderBaseUrlPipe,
	modelProviderHeadersPipe,
	modelProviderProtocolPipe,
	type ModelProvider,
} from '../domain/model-provider'
import type {
	ArchivedSecretReferenceError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../types'

const createModelProviderInputPipe = v.object({
	name: nonEmptyTrimmedStringPipe,
	protocol: modelProviderProtocolPipe,
	baseUrl: modelProviderBaseUrlPipe,
	auth: v.nullable(modelProviderAuthPipe),
	headers: modelProviderHeadersPipe,
})
export type Input = PipeOutput<typeof createModelProviderInputPipe>

export type Result = ModelProvider

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ArchivedSecretReferenceError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCreateModelProviderCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('createModelProvider', createModelProviderInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		const id = nextId(options, 'model-provider')
		if (!id.ok) return Promise.resolve(id)

		return withTransaction(options, async (tx): Promise<CoreResult<ModelProvider, Exclude<Error, InvalidInputError>>> => {
			const references = secretReferencesFromModelProviderConfig(input.auth, input.headers)
			const validReferences = await validateActiveSecretReferences(tx, references)
			if (!validReferences.ok) return validReferences

			const provider: ModelProvider = {
				id: id.value,
				name: input.name,
				protocol: input.protocol,
				baseUrl: input.baseUrl,
				auth: input.auth,
				headers: input.headers,
				created: stamp.value,
				updated: null,
				archivePeriods: [],
			}

			const stored = await putRecord('model-provider', tx.modelProviders, provider.id, provider)
			if (!stored.ok) return stored

			return { ok: true, value: provider }
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp } = await import('./test-utils')

	describe('createModelProvider command', () => {
		it('creates Model Providers with normalized config', async () => {
			const options = createTestOpenCoreOptions()
			const command = createCreateModelProviderCommand(options)

			const result = await command(
				{ name: '  Anthropic  ', protocol: 'anthropic-messages', baseUrl: ' https://api.example.com ', auth: null, headers: [] },
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'model-provider-1',
					name: 'Anthropic',
					protocol: 'anthropic-messages',
					baseUrl: 'https://api.example.com',
					auth: null,
					headers: [],
					created: localStamp(),
					updated: null,
					archivePeriods: [],
				},
			})
		})
	})
}
