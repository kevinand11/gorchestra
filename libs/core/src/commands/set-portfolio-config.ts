import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { portfolioConfigPipe, type PortfolioConfigRecord } from '../domain/config'
import type { InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	loadSelectableModelFacts,
	modelIdsFromModelUses,
	modelUsesFromPortfolioConfig,
	normalizePortfolioConfig,
	setPortfolioConfig,
	validateModelUseConfigs,
	withAuditStampTransaction,
} from './utils/storage'

const setPortfolioConfigInputPipe = v.object({ config: portfolioConfigPipe })
export type Input = PipeOutput<typeof setPortfolioConfigInputPipe>

export type Result = PortfolioConfigRecord

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createSetPortfolioConfigCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('setPortfolioConfig', setPortfolioConfigInputPipe, (input, context) =>
		withAuditStampTransaction(
			runtime,
			context,
			async (storage, stamp): Promise<CoreResult<PortfolioConfigRecord, Exclude<Error, InvalidInputError>>> => {
				const config = normalizePortfolioConfig(input.config)
				const modelUses = modelUsesFromPortfolioConfig(config)
				const facts = await loadSelectableModelFacts(storage, modelIdsFromModelUses(modelUses))
				if (!facts.ok) return facts

				const modelUseValidation = validateModelUseConfigs(facts.value, modelUses)
				if (!modelUseValidation.ok) return modelUseValidation

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
							default: { modelId: ' model-1 ', thinkingLevel: 'off' },
							planning: null,
							revisionPlanning: { modelId: 'model-1', thinkingLevel: 'off' },
							execution: null,
							revisionExecution: null,
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
							default: { modelId: 'model-1', thinkingLevel: 'off' },
							planning: null,
							revisionPlanning: { modelId: 'model-1', thinkingLevel: 'off' },
							execution: null,
							revisionExecution: null,
						},
						work: { maxProcessableSliceSlots: 2, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
					},
				},
			})
			expect(options.tx.portfolioConfig.record).toEqual(result.ok ? result.value : null)
		})
	})
}
