import { v, type PipeOutput } from 'valleyed'

import type { Action } from '../domain/action'
import { idPipe, type AuditStamp, type OperationContext } from '../domain/commons'
import { deliveryConfigPipe, type DeliveryConfigRecord } from '../domain/config'
import type { Delivery, DeliveryWorkState } from '../domain/delivery'
import type { DeliveryWorkStateMismatchError, InvalidInputError, InvariantViolationError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreServices, CoreStorageTransaction } from '../services'
import { buildCommandHandler } from '../utils/command'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from '../utils/command-errors'
import {
	auditStamp,
	deliveryWorkStateMismatch,
	modelIdsFromDeliveryConfigRecord,
	normalizeDeliveryConfigRecord,
	putRecord,
	validateSelectableModels,
	withTransaction,
} from '../utils/command-storage'
import { buildDeliveryContext } from '../utils/delivery-context'
import type { Result as CoreResult } from '../utils/types'
import { getDeliveryState } from '../utils/work-state'

const configureDeliveryInputPipe = v.object({ deliveryId: idPipe, config: deliveryConfigPipe })
export type Input = PipeOutput<typeof configureDeliveryInputPipe>

export type Result = Delivery

export type Error =
	| InvalidInputError
	| ConfigCommandReferenceError
	| ConfigCommandStorageError
	| DeliveryWorkStateMismatchError
	| InvariantViolationError

/** Requires Delivery Work State not closed. Does not clear preflight-failed. */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createConfigureDeliveryCommand(runtime: CoreRuntime): Operation {
	const options = runtime.services
	return buildCommandHandler('configureDelivery', configureDeliveryInputPipe, (input, context) =>
		handleConfigureDelivery(options, input, context),
	)
}

async function handleConfigureDelivery(
	options: CoreServices,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const stampResult = auditStamp(options, context)
	if (!stampResult.ok) return stampResult

	return withTransaction(options, (tx) => writeDeliveryConfig(tx, input, stampResult.value))
}

async function writeDeliveryConfig(
	tx: CoreStorageTransaction,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const deliveryResult = await requireOpenDelivery(tx, input.deliveryId)
	if (!deliveryResult.ok) return deliveryResult

	const config = normalizeDeliveryConfigRecord(input.config, stamp)
	const referenceValidation = await validateSelectableModels(tx, modelIdsFromDeliveryConfigRecord(config))
	if (!referenceValidation.ok) return referenceValidation

	return writeConfiguredDelivery(tx, deliveryResult.value, config)
}

async function requireOpenDelivery(
	tx: CoreStorageTransaction,
	deliveryId: string,
): Promise<CoreResult<Delivery, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(tx, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const deliveryState = getDeliveryState(deliveryContext.value)
	if (!deliveryState.ok) return deliveryState

	return deliveryState.value.type === 'closed'
		? closedDeliveryMismatch(deliveryId, deliveryState.value)
		: { ok: true, value: deliveryContext.value.delivery }
}

async function writeConfiguredDelivery(
	tx: CoreStorageTransaction,
	existing: Delivery,
	config: DeliveryConfigRecord,
): Promise<CoreResult<Delivery, Exclude<Error, InvalidInputError>>> {
	const delivery: Delivery = { ...existing, config }
	const putResult = await putRecord('delivery', tx.deliveries, delivery.id, delivery)
	if (!putResult.ok) return putResult

	return { ok: true, value: delivery }
}

function closedDeliveryMismatch(deliveryId: string, actual: DeliveryWorkState): CoreResult<never, DeliveryWorkStateMismatchError> {
	return deliveryWorkStateMismatch(deliveryId, openDeliveryStateTypes, actual)
}

const openDeliveryStateTypes: Exclude<DeliveryWorkState['type'], 'closed'>[] = [
	'unqueued',
	'dependency-blocked',
	'preflight-failed',
	'needs-artifact-creation',
	'slices-incomplete',
	'delivery-operation-failed',
	'delivery-validation-failed',
	'delivery-review-failed',
	'needs-artifact-validation',
	'needs-review-surface',
	'awaiting-review',
	'ready-to-ship',
]

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedDelivery, seedSelectableModel, validationEvidence } =
		await import('../utils/test-helpers')

	describe('configureDelivery command', () => {
		it('validates input before reading storage', async () => {
			const command = createConfigureDeliveryCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'configureDelivery' },
			})
		})

		it('returns not-found when the Delivery does not exist', async () => {
			const command = createConfigureDeliveryCommand(createTestCoreRuntime())

			const result = await command({ deliveryId: 'missing-delivery', config: allNullConfig() }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'delivery', id: 'missing-delivery' } })
		})

		it('sets Delivery config and validates referenced Models are selectable', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, 'delivery-1')
			seedSelectableModel(options.tx, 'execution-model')
			const command = createConfigureDeliveryCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					deliveryId: 'delivery-1',
					config: {
						model: deliveryModelConfig('execution-model'),
						work: { maxProcessableSliceSlots: 2, maxCorrectionRetriesPerFailure: 3, modelTimeoutMs: 1000 },
					},
				},
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					...options.tx.deliveries.records.get('delivery-1'),
					config: {
						configured: localStamp(),
						value: {
							model: deliveryModelConfig('execution-model'),
							work: { maxProcessableSliceSlots: 2, maxCorrectionRetriesPerFailure: 3, modelTimeoutMs: 1000 },
						},
					},
				},
			})
			expect(options.tx.deliveries.records.get('delivery-1')).toEqual(result.ok ? result.value : null)
		})

		it('folds all-null Delivery config to a retained null config record', async () => {
			const { command, options } = configureFixture()

			const result = await command({ deliveryId: 'delivery-1', config: allNullConfig() }, context)

			expectNullDeliveryConfig(result)
			expect(options.tx.deliveries.records.get('delivery-1')?.config).toEqual({ configured: localStamp(), value: null })
		})

		it('rejects missing Delivery Model references', async () => {
			const { command } = configureFixture()

			const result = await command(
				{
					deliveryId: 'delivery-1',
					config: { model: deliveryModelConfig('missing-model'), work: null },
				},
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'model', id: 'missing-model' } })
		})

		it('rejects archived Delivery Model references', async () => {
			const { command, options } = configureFixture()
			seedSelectableModel(options.tx, 'execution-model', { modelArchived: true })

			const result = await command(
				{
					deliveryId: 'delivery-1',
					config: { model: deliveryModelConfig('execution-model'), work: null },
				},
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'archived-model-reference', modelId: 'execution-model' } })
		})

		it('rejects closed Deliveries', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, 'delivery-1')
			seedAction(options.tx, 'ship-existing', '2026-06-10T00:00:00.000Z', {
				type: 'ship-delivery',
				integration: { type: 'observed-artifact-integration', actionId: 'observe-integration' },
			})
			const command = createConfigureDeliveryCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: 'delivery-1', config: allNullConfig() }, context)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'delivery-work-state-mismatch',
					deliveryId: 'delivery-1',
					expected: openDeliveryStateTypes,
					actual: { type: 'closed', outcome: 'shipped', actionId: 'ship-existing' },
				},
			})
		})

		it('configures a preflight-failed Delivery without clearing the failed preflight Action', async () => {
			const { command, options } = configureFixture()
			seedAction(options.tx, 'queue-delivery', '2026-06-10T00:00:00.000Z', { type: 'queue-delivery' })
			seedAction(options.tx, 'preflight-failed', '2026-06-10T00:01:00.000Z', {
				type: 'validate-preflight',
				checks: [validationEvidence('delivery-preflight', false, 'Missing config.')],
			})

			const result = await command({ deliveryId: 'delivery-1', config: allNullConfig() }, context)

			expectNullDeliveryConfig(result)
			expect(options.tx.actions.records.get('preflight-failed')).toMatchObject({ result: { type: 'validate-preflight' } })
		})
	})

	function expectNullDeliveryConfig(result: CoreResult<Result, Error>) {
		expect(result).toMatchObject({ ok: true, value: { config: { configured: localStamp(), value: null } } })
	}

	function configureFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, 'delivery-1')

		return { options, command: createConfigureDeliveryCommand(createTestCoreRuntime(options)) }
	}

	function allNullConfig(): Input['config'] {
		return { model: null, work: null }
	}

	function deliveryModelConfig(executionModelId: string): NonNullable<Input['config']['model']> {
		return { revisionPlanningModelId: null, executionModelId, revisionExecutionModelId: null }
	}

	function seedAction(
		tx: ReturnType<typeof createTestCoreServices>['tx'],
		id: string,
		at: string,
		result: Action['result'],
		authorized: AuditStamp | null = localStamp(),
	) {
		tx.actions.records.set(id, { id, deliveryId: 'delivery-1', performed: { at }, authorized, result })
	}
}
