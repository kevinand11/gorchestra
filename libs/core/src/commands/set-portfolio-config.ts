import { v, type PipeOutput } from 'valleyed'

import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './errors'
import {
	auditStamp,
	modelIdsFromPortfolioConfig,
	normalizePortfolioConfig,
	putSingleton,
	validateSelectableModels,
	withTransaction,
} from './storage-utils'
import { buildCommandHandler } from './utils'
import type { OperationContext } from '../domain/commons'
import { portfolioConfigPipe, type PortfolioConfigRecord } from '../domain/config'
import type { InvalidInputError } from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../utils/types'

const setPortfolioConfigInputPipe = v.object({ config: portfolioConfigPipe })
export type Input = PipeOutput<typeof setPortfolioConfigInputPipe>

export type Result = PortfolioConfigRecord

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createSetPortfolioConfigCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('setPortfolioConfig', setPortfolioConfigInputPipe, (input, context) => {
		const stampResult = auditStamp(options, context)
		if (!stampResult.ok) return Promise.resolve(stampResult)

		return withTransaction(options, async (tx): Promise<CoreResult<PortfolioConfigRecord, Exclude<Error, InvalidInputError>>> => {
			const config = normalizePortfolioConfig(input.config)
			const referenceValidation = await validateSelectableModels(tx, modelIdsFromPortfolioConfig(config))
			if (!referenceValidation.ok) return referenceValidation

			const record: PortfolioConfigRecord = { configured: stampResult.value, value: config }
			const putResult = await putSingleton('portfolio-config', tx.portfolioConfig, record)
			if (!putResult.ok) return putResult

			return { ok: true, value: record }
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSelectableModel } = await import('./test-utils')

	describe('setPortfolioConfig command', () => {
		it('sets Portfolio config with normalized config and selectable Model validation', async () => {
			const options = createTestOpenCoreOptions()
			seedSelectableModel(options.tx, 'model-1')
			const command = createSetPortfolioConfigCommand(options)

			const result = await command(
				{
					config: {
						model: {
							defaultModelId: ' model-1 ',
							planningModelId: null,
							revisionPlanningModelId: 'model-1',
							executionModelId: null,
							revisionExecutionModelId: null,
						},
						work: { maxActiveSliceSlots: 2, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
					},
				},
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					configured: localStamp(),
					value: {
						model: {
							defaultModelId: 'model-1',
							planningModelId: null,
							revisionPlanningModelId: 'model-1',
							executionModelId: null,
							revisionExecutionModelId: null,
						},
						work: { maxActiveSliceSlots: 2, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
					},
				},
			})
			expect(options.tx.portfolioConfig.record).toEqual(result.ok ? result.value : null)
		})
	})
}
