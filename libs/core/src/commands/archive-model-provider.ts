import { v, type PipeOutput } from 'valleyed'

import { archiveRecord, auditStamp, getRequired, putRecord, withTransaction } from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import { modelProviderPipe, type ModelProvider } from '../domain/model-provider'
import type {
	AlreadyArchivedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../utils/types'

const archiveModelProviderInputPipe = v.object({ modelProviderId: idPipe })
export type Input = PipeOutput<typeof archiveModelProviderInputPipe>

export type Result = ModelProvider

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| AlreadyArchivedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createArchiveModelProviderCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('archiveModelProvider', archiveModelProviderInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		return withTransaction(options, async (tx): Promise<CoreResult<ModelProvider, Exclude<Error, InvalidInputError>>> => {
			const existing = await getRequired('model-provider', tx.modelProviders, input.modelProviderId, modelProviderPipe)
			if (!existing.ok) return existing

			const archived = archiveRecord(existing.value, stamp.value, 'model-provider', input.modelProviderId)
			if (!archived.ok) return archived

			const stored = await putRecord('model-provider', tx.modelProviders, archived.value.id, archived.value)
			if (!stored.ok) return stored

			return archived
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp } = await import('./test-utils')

	describe('archiveModelProvider command', () => {
		it('archives Model Providers while preserving Archive Period history', async () => {
			const options = createTestOpenCoreOptions()
			options.tx.modelProviders.records.set('provider-1', {
				id: 'provider-1',
				name: 'Provider',
				protocol: 'anthropic-messages',
				baseUrl: 'https://api.example.com',
				auth: null,
				headers: [],
				created: localStamp(),
				updated: null,
				archivePeriods: [],
			})
			const command = createArchiveModelProviderCommand(options)

			const result = await command({ modelProviderId: 'provider-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: localStamp(), unarchived: null }] } })
		})
	})
}
