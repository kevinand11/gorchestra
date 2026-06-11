import { v, type PipeOutput } from 'valleyed'

import { deliveryWorkStateMismatch, prepareAuthorizedAction, putRecord, readDeliveryWorkState, withTransaction } from './storage-utils'
import { buildCommandHandler } from './utils'
import type { Action } from '../domain/action'
import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import type { Delivery, DeliveryIntegration, DeliveryWorkState } from '../domain/delivery'
import type {
	DeliveryWorkStateMismatchError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorageTransaction, OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../utils/types'

const shipDeliveryInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof shipDeliveryInputPipe>

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

/** Requires Delivery Work State ready-to-ship; records exactly one ship-delivery Action without post-merge validation in v1; duplicate calls fail with delivery-work-state-mismatch. */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createShipDeliveryCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('shipDelivery', shipDeliveryInputPipe, (input, context) => handleShipDelivery(options, input, context))
}

async function handleShipDelivery(
	options: OpenCoreOptions,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const authorizedAction = prepareAuthorizedAction(options, context)
	if (!authorizedAction.ok) return authorizedAction

	return withTransaction(options, (tx) => writeShipDelivery(tx, input, authorizedAction.value.stamp, authorizedAction.value.actionId))
}

async function writeShipDelivery(
	tx: CoreStorageTransaction,
	input: Input,
	stamp: AuditStamp,
	actionId: Id,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const deliveryResult = await requireReadyToShipDelivery(tx, input.deliveryId)
	if (!deliveryResult.ok) return deliveryResult

	const action = shipDeliveryAction(input.deliveryId, deliveryResult.value.integration, stamp, actionId)
	const putResult = await putRecord('action', tx.actions, action.id, action)
	if (!putResult.ok) return putResult

	return { ok: true, value: { delivery: deliveryResult.value.delivery, action } }
}

async function requireReadyToShipDelivery(
	tx: CoreStorageTransaction,
	deliveryId: Id,
): Promise<CoreResult<{ delivery: Delivery; integration: DeliveryIntegration }, Exclude<Error, InvalidInputError>>> {
	const deliveryState = await readDeliveryWorkState(tx, deliveryId)
	if (!deliveryState.ok) return deliveryState

	return deliveryState.value.state.type === 'ready-to-ship'
		? { ok: true, value: { delivery: deliveryState.value.delivery, integration: deliveryState.value.state.integration } }
		: deliveryWorkStateMismatch(deliveryId, ['ready-to-ship'], deliveryState.value.state)
}

function shipDeliveryAction(deliveryId: Id, integration: DeliveryIntegration, stamp: AuditStamp, actionId: Id): Action {
	return {
		id: actionId,
		deliveryId,
		performed: { at: stamp.at },
		authorized: stamp,
		result: { type: 'ship-delivery', integration },
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const {
		context,
		createTestOpenCoreOptions,
		externalOperationEvidence,
		localStamp,
		seedDelivery,
		seedSlice,
		stamp,
		validationEvidence,
	} = await import('./test-utils')
	const deliveryValidation = validationEvidence('delivery-branch-validation', true, 'Valid.')
	const sliceValidation = validationEvidence('slice-branch-validation', true, 'Valid.')
	const slicePromotion = externalOperationEvidence('merge-review-surface', true, 'Merged.')
	const observedIntegration = externalOperationEvidence('observe-artifact-integration', true, 'Integrated.')

	describe('shipDelivery command', () => {
		it('validates input before reading storage', async () => {
			const command = createShipDeliveryCommand(createTestOpenCoreOptions())

			const result = await command({} as never, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'shipDelivery' } })
		})

		it('returns not-found when the Delivery does not exist', async () => {
			const command = createShipDeliveryCommand(createTestOpenCoreOptions())

			const result = await command({ deliveryId: 'missing-delivery' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'delivery', id: 'missing-delivery' } })
		})

		it('records an authorized ship-delivery Action when a Delivery Review Surface was merged', async () => {
			const options = createTestOpenCoreOptions()
			seedReadyToShipDelivery(options.tx, { integration: 'review-surface-merged' })
			const command = createShipDeliveryCommand(options)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					delivery: options.tx.deliveries.records.get('delivery-1'),
					action: {
						id: 'action-1',
						deliveryId: 'delivery-1',
						performed: { at: '2026-06-10T12:00:00.000Z' },
						authorized: localStamp(),
						result: {
							type: 'ship-delivery',
							integration: { type: 'review-surface-merged', reviewSurfaceId: 'delivery-review' },
						},
					},
				},
			})
			expect(options.tx.actions.records.get('action-1')).toEqual(result.ok ? result.value.action : null)
		})

		it('records observed artifact integration when no Delivery Review Surface is needed', async () => {
			const options = createTestOpenCoreOptions()
			seedReadyToShipDelivery(options.tx, { integration: 'observed-artifact-integration' })
			const command = createShipDeliveryCommand(options)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toMatchObject({
				ok: true,
				value: {
					action: {
						result: {
							type: 'ship-delivery',
							integration: { type: 'observed-artifact-integration', actionId: 'observe-integration' },
						},
					},
				},
			})
		})

		it('rejects shipping unless Delivery Work State is ready-to-ship', async () => {
			const options = createTestOpenCoreOptions()
			seedDelivery(options.tx, 'delivery-1')
			const command = createShipDeliveryCommand(options)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expectDeliveryWorkStateMismatch(result, { type: 'unqueued' })
		})

		it('rejects duplicate shipping because closed Deliveries are not ready-to-ship', async () => {
			const options = createTestOpenCoreOptions()
			seedReadyToShipDelivery(options.tx, { integration: 'observed-artifact-integration' })
			options.tx.actions.records.set('ship-existing', {
				id: 'ship-existing',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T00:05:00.000Z' },
				authorized: localStamp(),
				result: { type: 'ship-delivery', integration: { type: 'observed-artifact-integration', actionId: 'observe-integration' } },
			})
			const command = createShipDeliveryCommand(options)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expectDeliveryWorkStateMismatch(result, { type: 'closed', outcome: 'shipped', actionId: 'ship-existing' })
		})
	})

	function expectDeliveryWorkStateMismatch(result: CoreResult<Result, Error>, actual: DeliveryWorkState) {
		expect(result).toEqual({
			ok: false,
			error: {
				type: 'delivery-work-state-mismatch',
				deliveryId: 'delivery-1',
				expected: ['ready-to-ship'],
				actual,
			},
		})
	}

	function seedReadyToShipDelivery(
		tx: ReturnType<typeof createTestOpenCoreOptions>['tx'],
		options: { integration: 'review-surface-merged' | 'observed-artifact-integration' },
	) {
		seedDelivery(tx, 'delivery-1', ['slice-1'])
		seedSlice(tx, 'slice-1', 'delivery-1')
		tx.deliveryArtifacts.records.set('delivery-artifact-1', {
			id: 'delivery-artifact-1',
			deliveryId: 'delivery-1',
			config: { type: 'source-control', deliveryBranch: 'delivery/1' },
			created: stamp,
		})
		seedAction(tx, 'queue-delivery', '2026-06-10T00:00:00.000Z', { type: 'queue-delivery' })
		seedAction(tx, 'promote-slice', '2026-06-10T00:01:00.000Z', {
			type: 'promote-slice-artifact',
			sliceId: 'slice-1',
			evidence: slicePromotion,
		})
		seedAction(tx, 'slice-complete', '2026-06-10T00:02:00.000Z', {
			type: 'validate-slice-delivery-artifact',
			sliceId: 'slice-1',
			evidence: sliceValidation,
		})
		seedAction(tx, 'delivery-validation', '2026-06-10T00:03:00.000Z', {
			type: 'validate-delivery-artifact',
			evidence: deliveryValidation,
		})
		if (options.integration === 'review-surface-merged') seedMergedDeliveryReviewSurface(tx)
		if (options.integration === 'observed-artifact-integration') {
			seedAction(tx, 'observe-integration', '2026-06-10T00:04:00.000Z', {
				type: 'observe-delivery-artifact-integration',
				evidence: observedIntegration,
			})
		}
	}

	function seedMergedDeliveryReviewSurface(tx: ReturnType<typeof createTestOpenCoreOptions>['tx']) {
		tx.reviewSurfaces.records.set('delivery-review', {
			id: 'delivery-review',
			scope: { type: 'delivery', deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
			config: {
				provider: 'github',
				pullRequestNumber: 1,
				repositoryId: 'repository-1',
				sourceBranch: 'delivery/1',
				targetBranch: 'main',
			},
			title: 'Delivery',
			body: 'Review delivery.',
			closed: {
				type: 'merged',
				merged: stamp,
				config: { type: 'source-control', repositoryId: 'repository-1', sourceBranch: 'delivery/1', targetBranch: 'main' },
			},
			created: stamp,
		})
	}

	function seedAction(tx: ReturnType<typeof createTestOpenCoreOptions>['tx'], id: string, at: string, result: Action['result']) {
		tx.actions.records.set(id, { id, deliveryId: 'delivery-1', performed: { at }, authorized: null, result })
	}
}
