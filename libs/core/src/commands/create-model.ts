import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe, jsonObjectPipe, nonEmptyTrimmedStringPipe } from '../domain/commons'
import { defaultModelCapabilities, type Model } from '../domain/model'
import type {
	ResourceArchivedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, createRecordValue, getRequired, isArchived, nextId } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const createModelInputPipe = v.object({
	providerId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	providerModelId: nonEmptyTrimmedStringPipe,
	providerOptions: v.defaults(v.nullable(jsonObjectPipe), null),
})
export type Input = PipeOutput<typeof createModelInputPipe>

export type Result = Model

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ResourceArchivedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createCreateModelCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createModel', createModelInputPipe, (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		const id = nextId(runtime.values)
		if (!id.ok) return Promise.resolve(id)

		return runtime.transactions.run(async ({ storage }): Promise<CoreResult<Model, Exclude<Error, InvalidInputError>>> => {
			const provider = await getRequired('model-provider', storage, input.providerId)
			if (!provider.ok) return provider
			if (isArchived(provider.value.archivePeriods)) {
				return { ok: false, error: { type: 'resource-archived', resource: 'model-provider', id: input.providerId } }
			}

			const model: Model = {
				id: id.value,
				providerId: input.providerId,
				name: input.name,
				providerModelId: input.providerModelId,
				providerOptions: input.providerOptions,
				capabilities: defaultModelCapabilities,
				pricing: null,
				created: stamp.value,
				updated: null,
				archivePeriods: [],
			}
			return createRecordValue('model', storage, model)
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, seedModelProvider } = await import('../utils/test-helpers')

	describe('createModel command', () => {
		it('creates Models under active Providers', async () => {
			const options = createTestCoreServices()
			seedModelProvider(options.tx, '01k00000000000000000000032')
			const command = createCreateModelCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					providerId: '01k00000000000000000000032',
					name: ' Sonnet ',
					providerModelId: ' claude-sonnet ',
					providerOptions: { serviceTier: 'flex' },
				},
				context,
			)

			expect(result).toMatchObject({
				ok: true,
				value: {
					id: '01k00000000000000000010001',
					providerId: '01k00000000000000000000032',
					name: 'Sonnet',
					providerModelId: 'claude-sonnet',
					providerOptions: { serviceTier: 'flex' },
					capabilities: defaultModelCapabilities,
					pricing: null,
					archivePeriods: [],
				},
			})
		})
	})
}
