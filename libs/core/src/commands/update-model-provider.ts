import { v, type PipeOutput } from 'valleyed'

import { idPipe, nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import { modelProviderAuthPipe, modelProviderBaseUrlPipe, modelProviderHeadersPipe, type ModelProvider } from '../domain/model-provider'
import type {
	ArchivedSecretReferenceError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import { buildCommandHandler } from '../utils/command'
import {
	auditStamp,
	getRequired,
	updateRecordValue,
	validateActiveModelProviderSecretReferences,
	withTransaction,
} from '../utils/command-storage'
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
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ArchivedSecretReferenceError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createUpdateModelProviderCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('updateModelProvider', updateModelProviderInputPipe, (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		return withTransaction(runtime.services, async (storage): Promise<CoreResult<ModelProvider, Exclude<Error, InvalidInputError>>> => {
			const existing = await getRequired('model-provider', storage, input.modelProviderId)
			if (!existing.ok) return existing

			const validReferences = await validateActiveModelProviderSecretReferences(storage, input.auth, input.headers)
			if (!validReferences.ok) return validReferences

			return updateRecordValue('model-provider', storage, existing.value.id, {
				name: input.name,
				baseUrl: input.baseUrl,
				auth: input.auth,
				headers: input.headers,
				updated: stamp.value,
			})
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp } = await import('../utils/test-helpers')

	describe('updateModelProvider command', () => {
		it('updates Model Provider mutable config while preserving protocol', async () => {
			const options = createTestCoreServices()
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
			const command = createUpdateModelProviderCommand(createTestCoreRuntime(options))

			const result = await command(
				{ modelProviderId: 'provider-1', name: 'Updated', baseUrl: 'https://new.example.com', auth: null, headers: [] },
				context,
			)

			expect(result).toMatchObject({ ok: true, value: { id: 'provider-1', name: 'Updated', protocol: 'anthropic-messages' } })
		})
	})
}
