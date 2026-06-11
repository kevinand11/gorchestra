import { v, type PipeOutput } from 'valleyed'

import { idPipe, nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import { type Model } from '../domain/model'
import { modelProviderPipe } from '../domain/model-provider'
import type {
	ArchivedModelProviderReferenceError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { OpenCoreOptions } from '../services'
import { buildCommandHandler } from '../utils/command'
import {
	archivedModelProviderReference,
	auditStamp,
	getRequired,
	isArchived,
	nextId,
	putRecordValue,
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
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ArchivedModelProviderReferenceError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCreateModelCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('createModel', createModelInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		const id = nextId(options, 'model')
		if (!id.ok) return Promise.resolve(id)

		return withTransaction(options, async (tx): Promise<CoreResult<Model, Exclude<Error, InvalidInputError>>> => {
			const provider = await getRequired('model-provider', tx.modelProviders, input.providerId, modelProviderPipe)
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
			return putRecordValue('model', tx.models, model)
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, seedModelProvider } = await import('../utils/test-helpers')

	describe('createModel command', () => {
		it('creates Models under active Providers', async () => {
			const options = createTestOpenCoreOptions()
			seedModelProvider(options.tx, 'provider-1')
			const command = createCreateModelCommand(options)

			const result = await command({ providerId: 'provider-1', name: ' Sonnet ', providerModelId: ' claude-sonnet ' }, context)

			expect(result).toMatchObject({
				ok: true,
				value: { id: 'model-1', providerId: 'provider-1', name: 'Sonnet', providerModelId: 'claude-sonnet', archivePeriods: [] },
			})
		})
	})
}
