import { v, type PipeOutput } from 'valleyed'

import type { OperationContext } from '../domain/commons'
import { portfolioConfigPipe, type PortfolioConfigRecord } from '../domain/config'
import type { InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import { buildCommandHandler } from '../utils/command'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from '../utils/command-errors'
import {
	modelIdsFromPortfolioConfig,
	normalizePortfolioConfig,
	setPortfolioConfig,
	validateSelectableModels,
	withAuditStampTransaction,
} from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const setPortfolioConfigInputPipe = v.object({ config: portfolioConfigPipe })
export type Input = PipeOutput<typeof setPortfolioConfigInputPipe>

export type Result = PortfolioConfigRecord

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createSetPortfolioConfigCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('setPortfolioConfig', setPortfolioConfigInputPipe, (input, context) =>
		withAuditStampTransaction(
			runtime,
			context,
			async (storage, stamp): Promise<CoreResult<PortfolioConfigRecord, Exclude<Error, InvalidInputError>>> => {
				const config = normalizePortfolioConfig(input.config)
				const referenceValidation = await validateSelectableModels(storage, modelIdsFromPortfolioConfig(config))
				if (!referenceValidation.ok) return referenceValidation

				const record: PortfolioConfigRecord = { configured: stamp, value: config }
				const stored = await setPortfolioConfig(storage, record)
				return stored.ok ? { ok: true, value: { configured: stored.value.configured, value: stored.value.value } } : stored
			},
		),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSelectableModel } =
		await import('../utils/test-helpers')

	describe('setPortfolioConfig command', () => {
		it('sets Portfolio config with normalized config and selectable Model validation', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, 'model-1')
			const command = createSetPortfolioConfigCommand(createTestCoreRuntime(options))

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
						work: { maxProcessableSliceSlots: 2, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
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
						work: { maxProcessableSliceSlots: 2, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
					},
				},
			})
			expect(options.tx.portfolioConfig.record).toEqual(result.ok ? result.value : null)
		})
	})
}
