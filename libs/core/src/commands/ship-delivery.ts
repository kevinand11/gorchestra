import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { Action } from '../domain/action'
import { idPipe, type AuditStamp, type Id } from '../domain/commons'
import type { Delivery, DeliveryIntegration, DeliveryWorkState } from '../domain/delivery'
import type { InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { buildDeliveryContext, getDeliveryState } from '../utils/delivery-context'
import type { Result as CoreResult } from '../utils/types'
import type { DeliveryActionCommandError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import { deliveryWorkStateMismatch, updateRecordValue, withAuditStampTransaction } from './utils/storage'

const shipDeliveryInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof shipDeliveryInputPipe>

export type Result = Delivery

export type Error = DeliveryActionCommandError

/** Requires Delivery Work State ready-to-ship; sets Delivery.closed without post-merge validation in v1; duplicate calls fail with delivery-work-state-mismatch. */
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createShipDeliveryCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('shipDelivery', shipDeliveryInputPipe, (input, context) => handleShipDelivery(runtime, input, context))
}

function handleShipDelivery(
	runtime: CoreRuntime,
	input: Input,
	context: CommandContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return withAuditStampTransaction(runtime, context, (storage, stamp) => writeShipDelivery(storage, input, stamp))
}

async function writeShipDelivery(
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const deliveryResult = await requireReadyToShipDelivery(storage, input.deliveryId)
	if (!deliveryResult.ok) return deliveryResult

	return updateRecordValue('delivery', storage, deliveryResult.value.delivery.id, {
		closed: { type: 'shipped', shipped: stamp, integration: deliveryResult.value.integration },
	})
}

async function requireReadyToShipDelivery(
	storage: CoreStorage,
	deliveryId: Id,
): Promise<CoreResult<{ delivery: Delivery; integration: DeliveryIntegration }, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(storage, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const deliveryState = getDeliveryState(deliveryContext.value)
	if (!deliveryState.ok) return deliveryState

	return deliveryState.value.type === 'ready-to-ship'
		? { ok: true, value: { delivery: deliveryContext.value.delivery, integration: deliveryState.value.integration } }
		: deliveryWorkStateMismatch(deliveryId, ['ready-to-ship'], deliveryState.value)
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

			const result = await command({ deliveryId: '01k00000000000000000010019' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'delivery', id: '01k00000000000000000010019' } })
		})

		it('sets Delivery.closed when a Delivery Review Surface was merged', async () => {
			const options = createTestCoreServices()
			seedReadyToShipDelivery(options.tx, { integration: 'review-surface-merged' })
			const command = createShipDeliveryCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: '01k00000000000000000000008' }, context)

			const expected = {
				...options.tx.deliveries.records.get('01k00000000000000000000008')!,
				closed: {
					type: 'shipped' as const,
					shipped: localStamp(),
					integration: { type: 'review-surface-merged' as const, reviewSurfaceId: '01k00000000000000000000037' },
				},
			}
			expect(result).toEqual({ ok: true, value: expected })
			expect(options.tx.deliveries.records.get('01k00000000000000000000008')).toEqual(expected)
		})

		it('records observed artifact integration when no Delivery Review Surface is needed', async () => {
			const options = createTestCoreServices()
			seedReadyToShipDelivery(options.tx, { integration: 'observed-artifact-integration' })
			const command = createShipDeliveryCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: '01k00000000000000000000008' }, context)

			expect(result).toMatchObject({
				ok: true,
				value: {
					closed: {
						type: 'shipped',
						integration: { type: 'observed-artifact-integration', actionId: '01k00000000000000000000012' },
					},
				},
			})
		})

		it('rejects shipping unless Delivery Work State is ready-to-ship', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, '01k00000000000000000000008')
			const command = createShipDeliveryCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: '01k00000000000000000000008' }, context)

			expectDeliveryWorkStateMismatch(result, { type: 'unqueued' })
		})

		it('rejects duplicate shipping because closed Deliveries are not ready-to-ship', async () => {
			const options = createTestCoreServices()
			seedReadyToShipDelivery(options.tx, { integration: 'observed-artifact-integration' })
			options.tx.deliveries.records.get('01k00000000000000000000008')!.closed = {
				type: 'shipped',
				shipped: localStamp(),
				integration: { type: 'observed-artifact-integration', actionId: '01k00000000000000000000012' },
			}
			const command = createShipDeliveryCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: '01k00000000000000000000008' }, context)

			expectDeliveryWorkStateMismatch(result, { type: 'closed', outcome: 'shipped' })
		})
	})

	function expectDeliveryWorkStateMismatch(result: CoreResult<Result, Error>, actual: DeliveryWorkState) {
		expect(result).toEqual({
			ok: false,
			error: {
				type: 'delivery-work-state-mismatch',
				deliveryId: '01k00000000000000000000008',
				expected: ['ready-to-ship'],
				actual,
			},
		})
	}

	function seedReadyToShipDelivery(
		tx: ReturnType<typeof createTestCoreServices>['tx'],
		options: { integration: 'review-surface-merged' | 'observed-artifact-integration' },
	) {
		seedDelivery(tx, '01k00000000000000000000008')
		seedSlice(tx, '01k00000000000000000000042', '01k00000000000000000000008')
		tx.deliveryArtifacts.records.set('01k00000000000000000000010', {
			id: '01k00000000000000000000010',
			deliveryId: '01k00000000000000000000008',
			config: { type: 'source-control', deliveryBranch: 'delivery/1' },
			created: stamp,
		})
		tx.deliveries.records.get('01k00000000000000000000008')!.queued = localStamp()
		seedAction(tx, '01k00000000000000000000011', '2026-06-10T00:01:00.000Z', {
			type: 'promote-slice-artifact',
			sliceId: '01k00000000000000000000042',
			evidence: slicePromotion,
			dispatchStartedActionId: null,
		})
		seedAction(tx, '01k00000000000000000100043', '2026-06-10T00:02:00.000Z', {
			type: 'validate-slice-delivery-artifact',
			sliceId: '01k00000000000000000000042',
			evidence: sliceValidation,
			dispatchStartedActionId: null,
		})
		seedAction(tx, '01k00000000000000000000013', '2026-06-10T00:03:00.000Z', {
			type: 'validate-delivery-artifact',
			evidence: deliveryValidation,
			dispatchStartedActionId: null,
		})
		if (options.integration === 'review-surface-merged') seedMergedDeliveryReviewSurface(tx)
		if (options.integration === 'observed-artifact-integration') {
			seedAction(tx, '01k00000000000000000000012', '2026-06-10T00:04:00.000Z', {
				type: 'observe-delivery-artifact-integration',
				evidence: observedIntegration,
				dispatchStartedActionId: null,
			})
		}
	}

	function seedMergedDeliveryReviewSurface(tx: ReturnType<typeof createTestCoreServices>['tx']) {
		tx.reviewSurfaces.records.set('01k00000000000000000000037', {
			id: '01k00000000000000000000037',
			scope: { type: 'delivery', deliveryId: '01k00000000000000000000008', deliveryArtifactId: '01k00000000000000000000010' },
			config: {
				provider: 'github',
				pullRequestNumber: 1,
				repositoryId: '01k00000000000000000000034',
				sourceBranch: 'delivery/1',
				targetBranch: 'main',
			},
			title: 'Delivery',
			closed: {
				type: 'merged',
				merged: { at: stamp.at },
				config: {
					type: 'source-control',
					repositoryId: '01k00000000000000000000034',
					sourceBranch: 'delivery/1',
					targetBranch: 'main',
				},
			},
			created: { at: stamp.at },
		})
	}

	function seedAction(tx: ReturnType<typeof createTestCoreServices>['tx'], id: string, at: string, result: Action['result']) {
		tx.actions.records.set(id, { id, deliveryId: '01k00000000000000000000008', performed: { at }, authorized: null, result })
	}
}
