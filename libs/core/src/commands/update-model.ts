import { v, type PipeInput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe, nonEmptyTrimmedStringPipe } from '../domain/commons'
import { defaultModelCapabilities, modelCapabilitiesPipe, modelTokenPricingPipe, type Model } from '../domain/model'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { updateStoredRecordWithAudit } from './utils/storage'

const updateModelInputPipe = v.object({
	modelId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	capabilities: modelCapabilitiesPipe,
	pricing: v.nullable(modelTokenPricingPipe),
})
export type Input = PipeInput<typeof updateModelInputPipe>

export type Result = Model

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createUpdateModelCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('updateModel', updateModelInputPipe, (input, context) =>
		updateStoredRecordWithAudit(runtime, context, 'model', input.modelId, (model, stamp) => ({
			...model,
			name: input.name,
			capabilities: input.capabilities,
			pricing: input.pricing,
			updated: stamp,
		})),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSelectableModel } =
		await import('../utils/test-helpers')

	describe('updateModel command', () => {
		it('updates Model editable metadata', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, 'model-1')
			const command = createUpdateModelCommand(createTestCoreRuntime(options))
			const capabilities = { ...defaultModelCapabilities, maxOutputTokens: 8192 }
			const pricing = { unit: 'micro-usd-per-million-tokens' as const, input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }

			const result = await command({ modelId: 'model-1', name: ' Updated ', capabilities, pricing }, context)

			expect(result).toMatchObject({
				ok: true,
				value: { id: 'model-1', name: 'Updated', capabilities, pricing, updated: localStamp() },
			})
		})
	})
}
