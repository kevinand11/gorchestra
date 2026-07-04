import { v, type PipeOutput } from 'valleyed'

import { portfolioConfigRecordPipe, type PortfolioConfigRecord } from '../domain/config'
import type { InvalidCoreServiceOutputError, InvalidInputError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { getPortfolioConfig, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({})
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = v.nullable(portfolioConfigRecordPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetPortfolioConfigQuery(options: CoreServices): Operation {
	return buildQueryHandler('getPortfolioConfig', inputPipe, () =>
		withTransaction(options, async (storage) => {
			const record = await getPortfolioConfig(storage)
			return record.ok ? { ok: true, value: record.value === null ? null : portfolioConfigRecord(record.value) } : record
		}),
	)
}

function portfolioConfigRecord(record: PortfolioConfigRecord): PortfolioConfigRecord {
	return { configured: record.configured, value: record.value }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, localStamp } = await import('../utils/test-helpers')

	describe('getPortfolioConfig query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.portfolioConfig.fail.get = true
			const query = createGetPortfolioConfigQuery(options)

			const result = await query(null as unknown as Input)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getPortfolioConfig' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns null when Portfolio Config is unset', async () => {
			const result = await createGetPortfolioConfigQuery(createTestCoreServices())({})

			expect(result).toEqual({ ok: true, value: null })
		})

		it('returns the configured Portfolio Config record', async () => {
			const options = createTestCoreServices()
			const record: PortfolioConfigRecord = {
				configured: localStamp(),
				value: {
					model: {
						default: { modelId: 'model-1', thinkingLevel: 'none' },
						planning: null,
						revisionPlanning: null,
						execution: null,
						revisionExecution: null,
					},
					work: null,
				},
			}
			options.tx.portfolioConfig.record = record

			const result = await createGetPortfolioConfigQuery(options)({})

			expect(result).toEqual({ ok: true, value: record })
		})

		it('returns storage errors when Portfolio Config cannot be read', async () => {
			const options = createTestCoreServices()
			options.storage.on = () => {
				throw new Error('get failed')
			}

			const result = await createGetPortfolioConfigQuery(options)({})

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'get', resource: 'portfolio-config', id: null } },
			})
		})
	})
}
