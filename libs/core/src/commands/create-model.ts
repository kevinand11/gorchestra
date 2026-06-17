import { v, type PipeOutput } from 'valleyed'

import { idPipe, nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import { type Model } from '../domain/model'
import type {
	ArchivedModelProviderReferenceError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import { buildCommandHandler } from '../utils/command'
import {
	archivedModelProviderReference,
	auditStamp,
	getRequired,
	isArchived,
	nextId,
	createRecordValue,
	withTransaction,
} from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const createModelInputPipe = v.object({
	providerId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	providerModelId: nonEmptyTrimmedStringPipe,
})
export type Input = PipeOutput<typeof createModelInputPipe>

export type Result = Model

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ArchivedModelProviderReferenceError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCreateModelCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createModel', createModelInputPipe, (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		const id = nextId(runtime.values, 'model')
		if (!id.ok) return Promise.resolve(id)

		return withTransaction(runtime.services, async (storage): Promise<CoreResult<Model, Exclude<Error, InvalidInputError>>> => {
			const provider = await getRequired('model-provider', storage, input.providerId)
			if (!provider.ok) return provider
			if (isArchived(provider.value.archivePeriods)) return archivedModelProviderReference(input.providerId)

			const model: Model = {
				id: id.value,
				providerId: input.providerId,
				name: input.name,
				providerModelId: input.providerModelId,
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
			seedModelProvider(options.tx, 'provider-1')
			const command = createCreateModelCommand(createTestCoreRuntime(options))

			const result = await command({ providerId: 'provider-1', name: ' Sonnet ', providerModelId: ' claude-sonnet ' }, context)

			expect(result).toMatchObject({
				ok: true,
				value: { id: 'model-1', providerId: 'provider-1', name: 'Sonnet', providerModelId: 'claude-sonnet', archivePeriods: [] },
			})
		})
	})
}
