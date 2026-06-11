import { v, type PipeOutput } from 'valleyed'

import type { Action } from '../domain/action'
import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import type { DeliveryWorkConfig } from '../domain/config'
import type { Delivery } from '../domain/delivery'
import type { ValidationEvidence } from '../domain/evidence'
import type {
	DeliveryWorkStateMismatchError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorageTransaction, OpenCoreOptions } from '../services'
import { buildCommandHandler } from '../utils/command'
import {
	deliveryWorkStateMismatch,
	prepareAuthorizedAction,
	putRecord,
	readDeliveryWorkState,
	withTransaction,
} from '../utils/command-storage'
import { preflightDeliveryWork } from '../utils/delivery-preflight'
import type { Result as CoreResult } from '../utils/types'

const retryDeliveryPreflightInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof retryDeliveryPreflightInputPipe>

export interface Result {
	delivery: Delivery
	action: Action
}

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| DeliveryWorkStateMismatchError
	| InvariantViolationError

/**
 * Explicitly retries Delivery preflight for a Delivery whose Delivery Work State
 * is preflight-failed. Records a validate-preflight Action authorized by the
 * OperationContext; a passed retry supersedes the previous failure by ordering.
 */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createRetryDeliveryPreflightCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('retryDeliveryPreflight', retryDeliveryPreflightInputPipe, (input, context) =>
		handleRetryDeliveryPreflight(options, input, context),
	)
}

async function handleRetryDeliveryPreflight(
	options: OpenCoreOptions,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const authorizedAction = prepareAuthorizedAction(options, context)
	if (!authorizedAction.ok) return authorizedAction

	return withTransaction(options, (tx) =>
		writeDeliveryPreflightRetry(tx, input, authorizedAction.value.stamp, authorizedAction.value.actionId),
	)
}

async function writeDeliveryPreflightRetry(
	tx: CoreStorageTransaction,
	input: Input,
	stamp: AuditStamp,
	actionId: Id,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const deliveryResult = await requirePreflightFailedDelivery(tx, input.deliveryId)
	if (!deliveryResult.ok) return deliveryResult

	const evidence = await retryPreflightEvidence(tx, deliveryResult.value)
	if (!evidence.ok) return evidence

	return writePreflightAction(tx, deliveryResult.value, preflightAction(deliveryResult.value.id, evidence.value, stamp, actionId))
}

async function requirePreflightFailedDelivery(
	tx: CoreStorageTransaction,
	deliveryId: Id,
): Promise<CoreResult<Delivery, Exclude<Error, InvalidInputError>>> {
	const deliveryState = await readDeliveryWorkState(tx, deliveryId)
	if (!deliveryState.ok) return deliveryState

	return deliveryState.value.state.type === 'preflight-failed'
		? { ok: true, value: deliveryState.value.delivery }
		: deliveryWorkStateMismatch(deliveryId, ['preflight-failed'], deliveryState.value.state)
}

async function retryPreflightEvidence(
	tx: CoreStorageTransaction,
	delivery: Delivery,
): Promise<CoreResult<ValidationEvidence, Exclude<Error, InvalidInputError | DeliveryWorkStateMismatchError>>> {
	const preflight = await preflightDeliveryWork(tx, delivery)
	if (!preflight.ok) return preflight

	return {
		ok: true,
		value:
			preflight.value.type === 'passed'
				? deliveryPreflightEvidence(true, 'Delivery preflight passed.')
				: deliveryPreflightEvidence(false, preflight.value.summary),
	}
}

async function writePreflightAction(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	action: Action,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const putResult = await putRecord('action', tx.actions, action.id, action)
	if (!putResult.ok) return putResult

	return { ok: true, value: { delivery, action } }
}

function preflightAction(deliveryId: Id, evidence: ValidationEvidence, stamp: AuditStamp, actionId: Id): Action {
	return {
		id: actionId,
		deliveryId,
		performed: { at: stamp.at },
		authorized: stamp,
		result: { type: 'validate-preflight', evidence },
	}
}

function deliveryPreflightEvidence(passed: boolean, summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: 'delivery-preflight' }, passed, summary }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedDelivery, seedProject, seedSelectableModel, validationEvidence } =
		await import('../utils/test-helpers')
	const { deriveDeliveryWorkState } = await import('../utils/work-state')

	describe('retryDeliveryPreflight command', () => {
		it('validates input before reading storage', async () => {
			await expectInvalidInput(createRetryDeliveryPreflightCommand(createTestOpenCoreOptions())({} as never, context))
		})

		it('returns not-found when the target Delivery does not exist', async () => {
			await expectMissingDelivery(createRetryDeliveryPreflightCommand(createTestOpenCoreOptions()))
		})

		it('rejects retry unless Delivery Work State is preflight-failed', async () => {
			const options = createTestOpenCoreOptions()
			seedDelivery(options.tx, 'delivery-1')
			const command = createRetryDeliveryPreflightCommand(options)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'delivery-work-state-mismatch',
					deliveryId: 'delivery-1',
					expected: ['preflight-failed'],
					actual: { type: 'unqueued' },
				},
			})
		})

		it('records a passing preflight retry Action that clears preflight-failed Work State', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPassingPortfolioConfig(options)
			seedSelectableModel(options.tx, 'model-1')
			const command = createRetryDeliveryPreflightCommand(options)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					delivery: options.tx.deliveries.records.get('delivery-1'),
					action: expectedPreflightAction('action-1', true, 'Delivery preflight passed.'),
				},
			})
			expect(await deriveDeliveryWorkState(options.tx, 'delivery-1')).not.toMatchObject({
				ok: true,
				value: { type: 'preflight-failed' },
			})
		})

		it('records failed evidence when Portfolio Config is missing', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')

			expectRetrySummary(await retry(options), 'Portfolio Config is not configured.')
		})

		it('records failed evidence when the Delivery Project is missing', async () => {
			const options = preflightFailedFixture()

			expectRetrySummary(await retry(options), 'Delivery Project is missing.')
		})

		it('records failed evidence when the selected execution Model is missing', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPassingPortfolioConfig(options)

			expectRetrySummary(await retry(options), 'Selected Delivery execution Model is missing.')
		})

		it('records failed evidence when the selected execution Model is archived', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPassingPortfolioConfig(options)
			seedSelectableModel(options.tx, 'model-1', { modelArchived: true })

			expectRetrySummary(await retry(options), 'Selected Delivery execution Model is archived.')
		})

		it('records failed evidence when the selected execution Model Provider is archived', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPassingPortfolioConfig(options)
			seedSelectableModel(options.tx, 'model-1', { providerArchived: true })

			expectRetrySummary(await retry(options), 'Selected Delivery execution Model Provider is archived.')
		})

		it('records failed evidence when Delivery Work Config is unresolved', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPortfolioConfig(options, { work: null })
			seedSelectableModel(options.tx, 'model-1')

			expectRetrySummary(await retry(options), 'Delivery Work Config is not resolved.')
		})

		it('returns operation errors for storage failures instead of recording preflight evidence', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPassingPortfolioConfig(options)
			seedSelectableModel(options.tx, 'model-1')
			options.tx.actions.fail.put = true

			expect(await retry(options)).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'put', resource: 'action', id: 'action-1' } },
			})
		})
	})

	async function expectMissingDelivery(command: Operation) {
		expect(await command({ deliveryId: 'missing-delivery' }, context)).toEqual({
			ok: false,
			error: { type: 'not-found', resource: 'delivery', id: 'missing-delivery' },
		})
	}

	async function expectInvalidInput(result: Promise<CoreResult<Result, Error>>) {
		expect(await result).toMatchObject({
			ok: false,
			error: { type: 'invalid-input', boundary: 'command', operation: 'retryDeliveryPreflight' },
		})
	}

	function preflightFailedFixture() {
		const options = createTestOpenCoreOptions()
		seedDelivery(options.tx, 'delivery-1')
		options.tx.actions.records.set('queue-delivery', {
			id: 'queue-delivery',
			deliveryId: 'delivery-1',
			performed: { at: '2026-06-10T00:00:00.000Z' },
			authorized: localStamp(),
			result: { type: 'queue-delivery' },
		})
		options.tx.actions.records.set('preflight-failed', {
			id: 'preflight-failed',
			deliveryId: 'delivery-1',
			performed: { at: '2026-06-10T00:01:00.000Z' },
			authorized: localStamp(),
			result: { type: 'validate-preflight', evidence: validationEvidence('delivery-preflight', false, 'Missing config.') },
		})

		return options
	}

	async function retry(options: ReturnType<typeof preflightFailedFixture>) {
		return createRetryDeliveryPreflightCommand(options)({ deliveryId: 'delivery-1' }, context)
	}

	function seedPassingPortfolioConfig(options: ReturnType<typeof preflightFailedFixture>) {
		seedPortfolioConfig(options, { work: { maxActiveSliceSlots: 1, maxCorrectionRetriesPerFailure: 2, modelTimeoutMs: 1000 } })
	}

	function seedPortfolioConfig(options: ReturnType<typeof preflightFailedFixture>, config: { work: DeliveryWorkConfig | null }) {
		options.tx.portfolioConfig.record = {
			configured: localStamp(),
			value: {
				model: {
					defaultModelId: 'model-1',
					planningModelId: null,
					revisionPlanningModelId: null,
					executionModelId: null,
					revisionExecutionModelId: null,
				},
				work: config.work,
			},
		}
	}

	function expectRetrySummary(result: CoreResult<Result, Error>, summary: string) {
		expect(result).toMatchObject({ ok: true, value: { action: expectedPreflightAction('action-1', false, summary) } })
	}

	function expectedPreflightAction(id: string, passed: boolean, summary: string): Action {
		return {
			id,
			deliveryId: 'delivery-1',
			performed: { at: '2026-06-10T12:00:00.000Z' },
			authorized: localStamp(),
			result: { type: 'validate-preflight', evidence: deliveryPreflightEvidence(passed, summary) },
		}
	}
}
