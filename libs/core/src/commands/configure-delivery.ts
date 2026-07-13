import { v, type PipeInput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { deliveryConfigPipe } from '../domain/config'
import type { Delivery, DeliveryWorkState } from '../domain/delivery'
import type { DeliveryWorkStateMismatchError, InvalidInputError, InvariantViolationError } from '../errors'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from '../utils/command-errors'
import { buildCommandHandler } from '../utils/command-handler'
import {
	agentRunProfileIdsFromDeliveryConfigRecord,
	auditStamp,
	deliveryWorkStateMismatch,
	normalizeDeliveryConfigRecord,
	updateRecordValue,
	validateSelectableAgentRunProfiles,
} from '../utils/command-storage'
import { buildDeliveryContext, getDeliveryState } from '../utils/delivery-context'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const configureDeliveryInputPipe = v.object({ deliveryId: idPipe, config: deliveryConfigPipe })
export type Input = PipeInput<typeof configureDeliveryInputPipe>

export type Result = Delivery
export type Error =
	| InvalidInputError
	| ConfigCommandReferenceError
	| ConfigCommandStorageError
	| DeliveryWorkStateMismatchError
	| InvariantViolationError

/** Requires Delivery Work State not closed. Does not clear preflight-failed. */
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createConfigureDeliveryCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('configureDelivery', configureDeliveryInputPipe, async (input, context) => {
		const stampResult = auditStamp(runtime.values, context)
		if (!stampResult.ok) return stampResult

		return runtime.transactions.run<Result, Exclude<Error, InvalidInputError>>(async ({ storage }) => {
			const deliveryContext = await buildDeliveryContext(storage, input.deliveryId)
			if (!deliveryContext.ok) return deliveryContext

			const deliveryState = getDeliveryState(deliveryContext.value)
			if (!deliveryState.ok) return deliveryState
			if (deliveryState.value.type === 'closed') {
				return deliveryWorkStateMismatch(input.deliveryId, openDeliveryStateTypes, deliveryState.value)
			}

			const config = normalizeDeliveryConfigRecord(input.config, stampResult.value)
			const profileValidation = await validateSelectableAgentRunProfiles(storage, agentRunProfileIdsFromDeliveryConfigRecord(config))
			if (!profileValidation.ok) return profileValidation

			return updateRecordValue('delivery', storage, deliveryContext.value.delivery.id, { config })
		})
	})
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
	const {
		context,
		createTestCoreRuntime,
		createTestCoreServices,
		defaultDeliveryWorkConfig,
		localStamp,
		seedAction,
		seedAgentRunProfile,
		seedDelivery,
		validationEvidence,
	} = await import('../utils/test-helpers')

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

			const result = await command({ deliveryId: '01k00000000000000000010019', config: { work: null } }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'delivery', id: '01k00000000000000000010019' } })
		})

		it('sets Delivery config and validates referenced Agent Run Profiles are selectable', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, '01k00000000000000000000008')
			seedAgentRunProfile(options.tx, '01k00000000000000000000007', '01k00000000000000000000024')
			const command = createConfigureDeliveryCommand(createTestCoreRuntime(options))
			const config = { work: defaultDeliveryWorkConfig('01k00000000000000000000007') }

			const result = await command({ deliveryId: '01k00000000000000000000008', config }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					...options.tx.deliveries.records.get('01k00000000000000000000008'),
					config: { configured: localStamp(), value: config },
				},
			})
			expect(options.tx.deliveries.records.get('01k00000000000000000000008')).toEqual(result.ok ? result.value : null)
		})

		it('folds a cleared Delivery config override to a retained null config record', async () => {
			const { command, options } = configureFixture()

			const result = await command({ deliveryId: '01k00000000000000000000008', config: { work: null } }, context)

			expectNullDeliveryConfig(result)
			expect(options.tx.deliveries.records.get('01k00000000000000000000008')?.config).toEqual({
				configured: localStamp(),
				value: null,
			})
		})

		it('rejects missing Delivery Agent Run Profile references', async () => {
			const { command } = configureFixture()

			const result = await command(
				{ deliveryId: '01k00000000000000000000008', config: { work: defaultDeliveryWorkConfig('01k00000000000000000010020') } },
				context,
			)

			expect(result).toEqual({
				ok: false,
				error: { type: 'not-found', resource: 'agent-run-profile', id: '01k00000000000000000010020' },
			})
		})

		it('rejects archived Delivery Agent Run Profile references', async () => {
			const { command, options } = configureFixture()
			seedAgentRunProfile(options.tx, '01k00000000000000000000007', '01k00000000000000000000024', { archived: true })

			const result = await command(
				{ deliveryId: '01k00000000000000000000008', config: { work: defaultDeliveryWorkConfig('01k00000000000000000000007') } },
				context,
			)

			expect(result).toEqual({
				ok: false,
				error: { type: 'resource-archived', resource: 'agent-run-profile', id: '01k00000000000000000000007' },
			})
		})

		it('rejects closed Deliveries', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, '01k00000000000000000000008')
			options.tx.deliveries.records.get('01k00000000000000000000008')!.closed = {
				type: 'shipped',
				shipped: localStamp(),
				integration: { type: 'observed-artifact-integration', actionId: 'observe-integration' },
			}
			const command = createConfigureDeliveryCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: '01k00000000000000000000008', config: { work: null } }, context)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'delivery-work-state-mismatch',
					deliveryId: '01k00000000000000000000008',
					expected: openDeliveryStateTypes,
					actual: { type: 'closed', outcome: 'shipped' },
				},
			})
		})

		it('configures a preflight-failed Delivery without clearing the failed preflight Action', async () => {
			const { command, options } = configureFixture()
			options.tx.deliveries.records.get('01k00000000000000000000008')!.queued = localStamp()
			seedAction(options.tx, 'preflight-failed', '2026-06-10T00:01:00.000Z', {
				type: 'validate-preflight',
				checks: [validationEvidence('delivery-preflight', false, 'Missing config.')],
			})

			const result = await command({ deliveryId: '01k00000000000000000000008', config: { work: null } }, context)

			expectNullDeliveryConfig(result)
			expect(options.tx.actions.records.get('preflight-failed')).toMatchObject({ result: { type: 'validate-preflight' } })
		})
	})

	function expectNullDeliveryConfig(result: CoreResult<Result, Error>) {
		expect(result).toMatchObject({ ok: true, value: { config: { configured: localStamp(), value: null } } })
	}

	function configureFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, '01k00000000000000000000008')

		return { options, command: createConfigureDeliveryCommand(createTestCoreRuntime(options)) }
	}
}
