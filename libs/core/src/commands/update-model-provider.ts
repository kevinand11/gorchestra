import { v, type PipeOutput } from 'valleyed'

import {
	auditStamp,
	getRequired,
	putRecord,
	secretReferencesFromModelProviderConfig,
	validateActiveSecretReferences,
	withTransaction,
} from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import {
	modelProviderAuthPipe,
	modelProviderBaseUrlPipe,
	modelProviderHeadersPipe,
	modelProviderPipe,
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
import type { Result as CoreResult } from '../utils/types'

const updateModelProviderInputPipe = v.object({
	modelProviderId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	baseUrl: modelProviderBaseUrlPipe,
	auth: v.nullable(modelProviderAuthPipe),
	headers: modelProviderHeadersPipe,
})
export type Input = PipeOutput<typeof updateModelProviderInputPipe>

export type Result = ModelProvider

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ArchivedSecretReferenceError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createUpdateModelProviderCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('updateModelProvider', updateModelProviderInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		return withTransaction(options, async (tx): Promise<CoreResult<ModelProvider, Exclude<Error, InvalidInputError>>> => {
			const existing = await getRequired('model-provider', tx.modelProviders, input.modelProviderId, modelProviderPipe)
			if (!existing.ok) return existing

			const references = secretReferencesFromModelProviderConfig(input.auth, input.headers)
			const validReferences = await validateActiveSecretReferences(tx, references)
			if (!validReferences.ok) return validReferences

			const provider: ModelProvider = {
				...existing.value,
				name: input.name,
				baseUrl: input.baseUrl,
				auth: input.auth,
				headers: input.headers,
				updated: stamp.value,
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

	describe('updateModelProvider command', () => {
		it('updates Model Provider mutable config while preserving protocol', async () => {
			const options = createTestOpenCoreOptions()
			options.tx.modelProviders.records.set('provider-1', {
				id: 'provider-1',
				name: 'Provider',
				protocol: 'anthropic-messages',
				baseUrl: 'https://old.example.com',
				auth: null,
				headers: [],
				created: localStamp(),
				updated: null,
				archivePeriods: [],
			})
			const command = createUpdateModelProviderCommand(options)

			const result = await command(
				{ modelProviderId: 'provider-1', name: 'Updated', baseUrl: 'https://new.example.com', auth: null, headers: [] },
				context,
			)

			expect(result).toMatchObject({ ok: true, value: { id: 'provider-1', name: 'Updated', protocol: 'anthropic-messages' } })
		})
	})
}
