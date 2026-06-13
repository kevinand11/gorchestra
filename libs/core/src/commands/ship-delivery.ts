import { v, type PipeOutput } from 'valleyed'

import type { Action } from '../domain/action'
import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import type { Delivery, DeliveryIntegration, DeliveryWorkState } from '../domain/delivery'
import type { InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreServices, CoreStorageTransaction } from '../services'
import { buildCommandHandler } from '../utils/command'
import type { DeliveryActionCommandError } from '../utils/command-errors'
import { deliveryWorkStateMismatch, putRecordValue, withAuditStampTransaction } from '../utils/command-storage'
import { buildStoredDeliveryContext } from '../utils/delivery-context'
import { getDeliveryState } from '../utils/delivery-context'
import type { Result as CoreResult } from '../utils/types'

const shipDeliveryInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof shipDeliveryInputPipe>

export type Result = Delivery

export type Error = DeliveryActionCommandError

/** Requires Delivery Work State ready-to-ship; sets Delivery.closed without post-merge validation in v1; duplicate calls fail with delivery-work-state-mismatch. */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createShipDeliveryCommand(runtime: CoreRuntime): Operation {
	const options = runtime.services
	return buildCommandHandler('shipDelivery', shipDeliveryInputPipe, (input, context) => handleShipDelivery(options, input, context))
}

function handleShipDelivery(
	options: CoreServices,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return withAuditStampTransaction(options, context, (tx, stamp) => writeShipDelivery(tx, input, stamp))
}

async function writeShipDelivery(
	tx: CoreStorageTransaction,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const deliveryResult = await requireReadyToShipDelivery(tx, input.deliveryId)
	if (!deliveryResult.ok) return deliveryResult

	return putRecordValue('delivery', tx.deliveries, shipDelivery(deliveryResult.value.delivery, deliveryResult.value.integration, stamp))
}

async function requireReadyToShipDelivery(
	tx: CoreStorageTransaction,
	deliveryId: Id,
): Promise<CoreResult<{ delivery: Delivery; integration: DeliveryIntegration }, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildStoredDeliveryContext(tx, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const deliveryState = getDeliveryState(deliveryContext.value)
	if (!deliveryState.ok) return deliveryState

	return deliveryState.value.type === 'ready-to-ship'
		? { ok: true, value: { delivery: deliveryContext.value.delivery, integration: deliveryState.value.integration } }
		: deliveryWorkStateMismatch(deliveryId, ['ready-to-ship'], deliveryState.value)
}

function shipDelivery(delivery: Delivery, integration: DeliveryIntegration, stamp: AuditStamp): Delivery {
	return { ...delivery, closed: { type: 'shipped', shipped: stamp, integration } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const {
		context,
		createTestCoreRuntime,
		createTestCoreServices,
		externalOperationEvidence,
		localStamp,
		seedDelivery,
		seedSlice,
		stamp,
		validationEvidence,
	} = await import('../utils/test-helpers')
	const deliveryValidation = validationEvidence('delivery-branch-validation', true, 'Valid.')
	const sliceValidation = validationEvidence('slice-branch-validation', true, 'Valid.')
	const slicePromotion = externalOperationEvidence('merge-review-surface', true, 'Merged.')
	const observedIntegration = externalOperationEvidence('observe-artifact-integration', true, 'Integrated.')

	describe('shipDelivery command', () => {
		it('validates input before reading storage', async () => {
			const command = createShipDeliveryCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'shipDelivery' } })
		})

		it('returns not-found when the Delivery does not exist', async () => {
			const command = createShipDeliveryCommand(createTestCoreRuntime())

			const result = await command({ deliveryId: 'missing-delivery' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'delivery', id: 'missing-delivery' } })
		})

		it('sets Delivery.closed when a Delivery Review Surface was merged', async () => {
			const options = createTestCoreServices()
			seedReadyToShipDelivery(options.tx, { integration: 'review-surface-merged' })
			const command = createShipDeliveryCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			const expected = {
				...options.tx.deliveries.records.get('delivery-1')!,
				closed: {
					type: 'shipped' as const,
					shipped: localStamp(),
					integration: { type: 'review-surface-merged' as const, reviewSurfaceId: 'delivery-review' },
				},
			}
			expect(result).toEqual({ ok: true, value: expected })
			expect(options.tx.deliveries.records.get('delivery-1')).toEqual(expected)
		})

		it('records observed artifact integration when no Delivery Review Surface is needed', async () => {
			const options = createTestCoreServices()
			seedReadyToShipDelivery(options.tx, { integration: 'observed-artifact-integration' })
			const command = createShipDeliveryCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toMatchObject({
				ok: true,
				value: {
					closed: {
						type: 'shipped',
						integration: { type: 'observed-artifact-integration', actionId: 'observe-integration' },
					},
				},
			})
		})

		it('rejects shipping unless Delivery Work State is ready-to-ship', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, 'delivery-1')
			const command = createShipDeliveryCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expectDeliveryWorkStateMismatch(result, { type: 'unqueued' })
		})

		it('rejects duplicate shipping because closed Deliveries are not ready-to-ship', async () => {
			const options = createTestCoreServices()
			seedReadyToShipDelivery(options.tx, { integration: 'observed-artifact-integration' })
			options.tx.deliveries.records.get('delivery-1')!.closed = {
				type: 'shipped',
				shipped: localStamp(),
				integration: { type: 'observed-artifact-integration', actionId: 'observe-integration' },
			}
			const command = createShipDeliveryCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expectDeliveryWorkStateMismatch(result, { type: 'closed', outcome: 'shipped' })
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
		tx: ReturnType<typeof createTestCoreServices>['tx'],
		options: { integration: 'review-surface-merged' | 'observed-artifact-integration' },
	) {
		seedDelivery(tx, 'delivery-1')
		seedSlice(tx, 'slice-1', 'delivery-1')
		tx.deliveryArtifacts.records.set('delivery-artifact-1', {
			id: 'delivery-artifact-1',
			deliveryId: 'delivery-1',
			config: { type: 'source-control', deliveryBranch: 'delivery/1' },
			created: stamp,
		})
		tx.deliveries.records.get('delivery-1')!.queued = localStamp()
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

	function seedMergedDeliveryReviewSurface(tx: ReturnType<typeof createTestCoreServices>['tx']) {
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

	function seedAction(tx: ReturnType<typeof createTestCoreServices>['tx'], id: string, at: string, result: Action['result']) {
		tx.actions.records.set(id, { id, deliveryId: 'delivery-1', performed: { at }, authorized: null, result })
	}
}
