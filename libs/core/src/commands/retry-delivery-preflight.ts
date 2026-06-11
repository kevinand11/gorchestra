import { v, type PipeOutput } from 'valleyed'

import type { Action } from '../domain/action'
import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import type { DeliveryWorkConfig } from '../domain/config'
import type { Delivery } from '../domain/delivery'
import type { ValidationEvidence } from '../domain/evidence'
import type {
	DeliveryPreflightClaimConflictError,
	DeliveryWorkStateMismatchError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorageTransaction } from '../services'
import { buildCommandHandler } from '../utils/command'
import {
	deliveryWorkStateMismatch,
	prepareAuthorizedAction,
	putRecord,
	readDeliveryWorkState,
	withTransaction,
} from '../utils/command-storage'
import {
	providerBackedDeliveryPreflightInputsStillCurrent,
	readProviderBackedDeliveryPreflightPlan,
	runProviderBackedDeliveryPreflightChecks,
	type ProviderBackedDeliveryPreflightPlan,
} from '../utils/delivery-preflight'
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
	| DeliveryPreflightClaimConflictError
	| InvariantViolationError

/**
 * Explicitly retries Delivery preflight for a Delivery whose Delivery Work State
 * is preflight-failed. Records a validate-preflight Action authorized by the
 * OperationContext; a passed retry supersedes the previous failure by ordering.
 */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createRetryDeliveryPreflightCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('retryDeliveryPreflight', retryDeliveryPreflightInputPipe, (input, context) =>
		handleRetryDeliveryPreflight(runtime, input, context),
	)
}

async function handleRetryDeliveryPreflight(
	runtime: CoreRuntime,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const authorizedAction = prepareAuthorizedAction(runtime.services, context)
	if (!authorizedAction.ok) return authorizedAction

	const plan = await withTransaction(runtime.services, (tx) => readRetryPreflightPlan(tx, input))
	if (!plan.ok) return plan

	const checks = await runProviderBackedDeliveryPreflightChecks(runtime, plan.value.plan)
	if (!checks.ok) return checks

	return withTransaction(runtime.services, (tx) =>
		writeDeliveryPreflightRetry(
			tx,
			input.deliveryId,
			plan.value.plan,
			checks.value,
			authorizedAction.value.stamp,
			authorizedAction.value.actionId,
		),
	)
}

async function readRetryPreflightPlan(
	tx: CoreStorageTransaction,
	input: Input,
): Promise<CoreResult<{ delivery: Delivery; plan: ProviderBackedDeliveryPreflightPlan }, Exclude<Error, InvalidInputError>>> {
	const deliveryResult = await requirePreflightFailedDelivery(tx, input.deliveryId)
	if (!deliveryResult.ok) return deliveryResult

	const plan = await readProviderBackedDeliveryPreflightPlan(tx, deliveryResult.value)
	return plan.ok ? { ok: true, value: { delivery: deliveryResult.value, plan: plan.value } } : plan
}

async function writeDeliveryPreflightRetry(
	tx: CoreStorageTransaction,
	deliveryId: Id,
	plan: ProviderBackedDeliveryPreflightPlan,
	checks: ValidationEvidence[],
	stamp: AuditStamp,
	actionId: Id,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const deliveryResult = await requirePreflightFailedDelivery(tx, deliveryId)
	if (!deliveryResult.ok) return deliveryResult

	const freshness = await providerBackedDeliveryPreflightInputsStillCurrent(tx, deliveryResult.value, plan)
	if (!freshness.ok) return freshness
	if (!freshness.value) return deliveryPreflightClaimConflict(deliveryId)

	return writePreflightAction(tx, deliveryResult.value, preflightAction(deliveryResult.value.id, checks, stamp, actionId))
}

function deliveryPreflightClaimConflict(deliveryId: Id): CoreResult<never, DeliveryPreflightClaimConflictError> {
	return { ok: false, error: { type: 'delivery-preflight-claim-conflict', deliveryId } }
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

async function writePreflightAction(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	action: Action,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const putResult = await putRecord('action', tx.actions, action.id, action)
	if (!putResult.ok) return putResult

	return { ok: true, value: { delivery, action } }
}

function preflightAction(deliveryId: Id, checks: ValidationEvidence[], stamp: AuditStamp, actionId: Id): Action {
	return {
		id: actionId,
		deliveryId,
		performed: { at: stamp.at },
		authorized: stamp,
		result: { type: 'validate-preflight', checks },
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const {
		context,
		createTestCoreRuntime,
		createTestCoreServices,
		failingProviderBackedPreflightProviders,
		localStamp,
		passingProviderBackedPreflightProviders,
		seedDelivery,
		seedProject,
		seedSecret,
		seedSelectableModel,
		validationEvidence,
	} = await import('../utils/test-helpers')
	const { deriveDeliveryWorkState } = await import('../utils/work-state')

	describe('retryDeliveryPreflight command', () => {
		it('validates input before reading storage', async () => {
			await expectInvalidInput(createRetryDeliveryPreflightCommand(createTestCoreRuntime())({} as never, context))
		})

		it('returns not-found when the target Delivery does not exist', async () => {
			await expectMissingDelivery(createRetryDeliveryPreflightCommand(createTestCoreRuntime()))
		})

		it('rejects retry unless Delivery Work State is preflight-failed', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, 'delivery-1')
			const command = createRetryDeliveryPreflightCommand(createTestCoreRuntime(options))

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
			seedRepository(options)
			const command = createRetryDeliveryPreflightCommand(
				createTestCoreRuntime(options, { providers: passingProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					delivery: options.tx.deliveries.records.get('delivery-1'),
					action: expectedPassingProviderPreflightAction('action-1'),
				},
			})
			expect(await deriveDeliveryWorkState(options.tx, 'delivery-1')).not.toMatchObject({
				ok: true,
				value: { type: 'preflight-failed' },
			})
		})

		it('records all failed provider-backed preflight checks on retry', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPassingPortfolioConfig(options)
			seedSelectableModel(options.tx, 'model-1')
			seedRepository(options)
			const command = createRetryDeliveryPreflightCommand(
				createTestCoreRuntime(options, { providers: failingProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toMatchObject({
				ok: true,
				value: {
					action: {
						result: {
							type: 'validate-preflight',
							checks: [
								validationEvidence('repository-preflight', false, 'GitHub repository was not found.'),
								validationEvidence('model-preflight', false, 'Anthropic Messages model was not found.'),
							],
						},
					},
				},
			})
		})

		it('records failed evidence when Portfolio Config is missing', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')

			expectRetrySummary(await retry(options), 'Portfolio Config is not configured.')
		})

		it('returns operation error when the Delivery Project is missing', async () => {
			const options = preflightFailedFixture()

			expect(await retry(options)).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: 'project-1' } })
		})

		it('returns operation error when the selected execution Model is missing', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPassingPortfolioConfig(options)

			expect(await retry(options)).toEqual({ ok: false, error: { type: 'not-found', resource: 'model', id: 'model-1' } })
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

		it('returns a preflight claim conflict when provider-backed retry inputs become stale', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPassingPortfolioConfig(options)
			seedSelectableModel(options.tx, 'model-1')
			seedSelectableModel(options.tx, 'model-2')
			seedRepository(options)
			const providers = passingProviderBackedPreflightProviders()
			providers.modelProviderProtocols.preflightModel = () => {
				options.tx.portfolioConfig.record!.value.model.defaultModelId = 'model-2'
				return Promise.resolve({ ok: true, value: { type: 'passed', summary: 'Anthropic Messages model preflight passed.' } })
			}
			const command = createRetryDeliveryPreflightCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'delivery-preflight-claim-conflict', deliveryId: 'delivery-1' } })
			expect(options.tx.actions.records.has('action-1')).toBe(false)
		})

		it('returns a preflight claim conflict when local retry inputs become stale', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPortfolioConfig(options, { work: null })
			seedSelectableModel(options.tx, 'model-1')
			seedRepository(options)
			staleLocalPreflightOnSecondTransaction(options, () => {
				seedPassingPortfolioConfig(options)
			})

			const result = await retry(options)

			expect(result).toEqual({ ok: false, error: { type: 'delivery-preflight-claim-conflict', deliveryId: 'delivery-1' } })
			expect(options.tx.actions.records.has('action-1')).toBe(false)
		})

		it('returns operation errors for storage failures instead of recording preflight evidence', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPassingPortfolioConfig(options)
			seedSelectableModel(options.tx, 'model-1')
			seedRepository(options)
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
		const options = createTestCoreServices()
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
			result: { type: 'validate-preflight', checks: [validationEvidence('delivery-preflight', false, 'Missing config.')] },
		})

		return options
	}

	async function retry(options: ReturnType<typeof preflightFailedFixture>) {
		return createRetryDeliveryPreflightCommand(
			createTestCoreRuntime(options, { providers: passingProviderBackedPreflightProviders() }),
		)({ deliveryId: 'delivery-1' }, context)
	}

	function staleLocalPreflightOnSecondTransaction(options: ReturnType<typeof createTestCoreServices>, stale: () => void) {
		const transaction = options.storage.transaction
		let calls = 0
		options.storage.transaction = async (fn) => {
			calls += 1
			if (calls === 2) stale()
			return transaction(fn)
		}
	}

	function seedRepository(options: ReturnType<typeof preflightFailedFixture>) {
		seedSecret(options.tx, 'secret-1')
		options.tx.repositories.records.set('repository-1', {
			id: 'repository-1',
			projectId: 'project-1',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
			created: localStamp(),
		})
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

	function expectedPassingProviderPreflightAction(id: string): Action {
		return {
			id,
			deliveryId: 'delivery-1',
			performed: { at: '2026-06-10T12:00:00.000Z' },
			authorized: localStamp(),
			result: {
				type: 'validate-preflight',
				checks: [
					validationEvidence('repository-preflight', true, 'GitHub repository preflight passed.'),
					validationEvidence('model-preflight', true, 'Anthropic Messages model preflight passed.'),
				],
			},
		}
	}

	function expectedPreflightAction(id: string, passed: boolean, summary: string): Action {
		return {
			id,
			deliveryId: 'delivery-1',
			performed: { at: '2026-06-10T12:00:00.000Z' },
			authorized: localStamp(),
			result: { type: 'validate-preflight', checks: [validationEvidence('delivery-preflight', passed, summary)] },
		}
	}
}
