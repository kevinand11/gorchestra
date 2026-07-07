import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe, nonEmptyTrimmedStringPipe } from '../domain/commons'
import { modelProviderAuthPipe, modelProviderHeadersPipe, modelProviderOptionsPipe, type ModelProvider } from '../domain/model-provider'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	ResourceArchivedError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { auditStamp, getRequired, updateRecordValue, validateActiveModelProviderSecretReferences, withTransaction } from './utils/storage'

const updateModelProviderInputPipe = v.object({
	modelProviderId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	auth: v.nullable(modelProviderAuthPipe),
	headers: modelProviderHeadersPipe,
	providerOptions: v.nullable(modelProviderOptionsPipe),
})
export type Input = PipeOutput<typeof updateModelProviderInputPipe>

export type Result = ModelProvider

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ResourceArchivedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

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
				auth: input.auth,
				headers: input.headers,
				providerOptions: input.providerOptions,
				updated: stamp.value,
			})
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp } = await import('../utils/test-helpers')

	describe('updateModelProvider command', () => {
		it('updates Model Provider mutable config while preserving source', async () => {
			const options = createTestCoreServices()
			options.tx.modelProviders.records.set('01k00000000000000000000032', {
				id: '01k00000000000000000000032',
				name: 'Provider',
				source: { type: 'anthropic' },
				auth: null,
				headers: [],
				providerOptions: null,
				created: localStamp(),
				updated: null,
				archivePeriods: [],
			})
			const command = createUpdateModelProviderCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					modelProviderId: '01k00000000000000000000032',
					name: 'Updated',
					auth: null,
					headers: [],
					providerOptions: { beta: true },
				},
				context,
			)

			expect(result).toMatchObject({
				ok: true,
				value: {
					id: '01k00000000000000000000032',
					name: 'Updated',
					source: { type: 'anthropic' },
					providerOptions: { beta: true },
				},
			})
		})
	})
}
