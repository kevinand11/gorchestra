import { v, type PipeOutput } from 'valleyed'

import type { OperationContext } from '../domain/commons'
import { portfolioConfigPipe, type PortfolioConfigRecord } from '../domain/config'
import type { InvalidInputError } from '../errors'
import type { CoreServices } from '../services'
import { buildCommandHandler } from '../utils/command'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from '../utils/command-errors'
import {
	modelIdsFromPortfolioConfig,
	normalizePortfolioConfig,
	putSingletonValue,
	validateSelectableModels,
	withAuditStampTransaction,
} from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const setPortfolioConfigInputPipe = v.object({ config: portfolioConfigPipe })
export type Input = PipeOutput<typeof setPortfolioConfigInputPipe>

export type Result = PortfolioConfigRecord

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createSetPortfolioConfigCommand(options: CoreServices): Operation {
	return buildCommandHandler('setPortfolioConfig', setPortfolioConfigInputPipe, (input, context) =>
		withAuditStampTransaction(
			options,
			context,
			async (tx, stamp): Promise<CoreResult<PortfolioConfigRecord, Exclude<Error, InvalidInputError>>> => {
				const config = normalizePortfolioConfig(input.config)
				const referenceValidation = await validateSelectableModels(tx, modelIdsFromPortfolioConfig(config))
				if (!referenceValidation.ok) return referenceValidation

				const record: PortfolioConfigRecord = { configured: stamp, value: config }
				return putSingletonValue('portfolio-config', tx.portfolioConfig, record)
			},
		),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSelectableModel } = await import('../utils/test-helpers')

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
