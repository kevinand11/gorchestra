import { v, type PipeInput, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe, type AuditStamp } from '../domain/commons'
import { deliveryConfigPipe, type DeliveryConfigRecord } from '../domain/config'
import type { Delivery, DeliveryWorkState } from '../domain/delivery'
import type { DeliveryWorkStateMismatchError, InvalidInputError, InvariantViolationError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { buildDeliveryContext, getDeliveryState } from '../utils/delivery-context'
import type { Result as CoreResult } from '../utils/types'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	agentRunProfileIdsFromDeliveryConfigRecord,
	auditStamp,
	deliveryWorkStateMismatch,
	normalizeDeliveryConfigRecord,
	updateRecordValue,
	validateSelectableAgentRunProfiles,
	withTransaction,
} from './utils/storage'

const configureDeliveryInputPipe = v.object({ deliveryId: idPipe, config: deliveryConfigPipe })
export type Input = PipeInput<typeof configureDeliveryInputPipe>
type ValidatedInput = PipeOutput<typeof configureDeliveryInputPipe>

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
	return buildCommandHandler('configureDelivery', configureDeliveryInputPipe, (input, context) =>
		handleConfigureDelivery(runtime, input, context),
	)
}

async function handleConfigureDelivery(
	runtime: CoreRuntime,
	input: ValidatedInput,
	context: CommandContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const stampResult = auditStamp(runtime.values, context)
	if (!stampResult.ok) return stampResult

	return withTransaction(runtime.services, (storage) => writeDeliveryConfig(storage, input, stampResult.value))
}

async function writeDeliveryConfig(
	storage: CoreStorage,
	input: ValidatedInput,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const deliveryResult = await requireOpenDelivery(storage, input.deliveryId)
	if (!deliveryResult.ok) return deliveryResult

	const config = normalizeDeliveryConfigRecord(input.config, stamp)
	const profileValidation = await validateSelectableAgentRunProfiles(storage, agentRunProfileIdsFromDeliveryConfigRecord(config))
	if (!profileValidation.ok) return profileValidation

	return writeConfiguredDelivery(storage, deliveryResult.value, config)
}

async function requireOpenDelivery(
	storage: CoreStorage,
	deliveryId: string,
): Promise<CoreResult<Delivery, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(storage, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const deliveryState = getDeliveryState(deliveryContext.value)
	if (!deliveryState.ok) return deliveryState

	return deliveryState.value.type === 'closed'
		? closedDeliveryMismatch(deliveryId, deliveryState.value)
		: { ok: true, value: deliveryContext.value.delivery }
}

async function writeConfiguredDelivery(
	storage: CoreStorage,
	existing: Delivery,
	config: DeliveryConfigRecord,
): Promise<CoreResult<Delivery, Exclude<Error, InvalidInputError>>> {
	return updateRecordValue('delivery', storage, existing.id, { config })
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
