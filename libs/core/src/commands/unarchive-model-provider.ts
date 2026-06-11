import { v, type PipeOutput } from 'valleyed'

import { auditStamp, getRequired, putRecord, unarchiveRecord, withTransaction } from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import { modelProviderPipe, type ModelProvider } from '../domain/model-provider'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	NotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../utils/types'

const unarchiveModelProviderInputPipe = v.object({ modelProviderId: idPipe })
export type Input = PipeOutput<typeof unarchiveModelProviderInputPipe>

export type Result = ModelProvider

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| NotArchivedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createUnarchiveModelProviderCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('unarchiveModelProvider', unarchiveModelProviderInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		return withTransaction(options, async (tx): Promise<CoreResult<ModelProvider, Exclude<Error, InvalidInputError>>> => {
			const existing = await getRequired('model-provider', tx.modelProviders, input.modelProviderId, modelProviderPipe)
			if (!existing.ok) return existing

			const unarchived = unarchiveRecord(existing.value, stamp.value, 'model-provider', input.modelProviderId)
			if (!unarchived.ok) return unarchived

			const stored = await putRecord('model-provider', tx.modelProviders, unarchived.value.id, unarchived.value)
			if (!stored.ok) return stored

			return unarchived
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, stamp } = await import('./test-utils')

	describe('unarchiveModelProvider command', () => {
		it('unarchives Model Providers while preserving Archive Period history', async () => {
			const options = createTestOpenCoreOptions()
			options.tx.modelProviders.records.set('provider-1', {
				id: 'provider-1',
				name: 'Provider',
				protocol: 'anthropic-messages',
				baseUrl: 'https://api.example.com',
				auth: null,
				headers: [],
				created: stamp,
				updated: null,
				archivePeriods: [{ archived: stamp, unarchived: null }],
			})
			const command = createUnarchiveModelProviderCommand(options)

			const result = await command({ modelProviderId: 'provider-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: stamp, unarchived: localStamp() }] } })
		})
	})
}
