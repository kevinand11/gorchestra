import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { Action } from '../domain/action'
import { idPipe, type AuditStamp, type Id } from '../domain/commons'
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
import type { CoreStorage } from '../services'
import { withTwoPhaseTransaction } from '../storage/helpers'
import { buildDeliveryContext, getDeliveryState, type DeliveryContext } from '../utils/delivery-context'
import {
	providerBackedDeliveryPreflightInputsStillCurrent,
	readProviderBackedDeliveryPreflightPlan,
	runProviderBackedDeliveryPreflightChecks,
	type ProviderBackedDeliveryPreflightPlan,
} from '../utils/delivery-preflight'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { createRecord, deliveryWorkStateMismatch, prepareAuthorizedAction } from './utils/storage'

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
 * CommandContext; a passed retry supersedes the previous failure by ordering.
 */
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createRetryDeliveryPreflightCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('retryDeliveryPreflight', retryDeliveryPreflightInputPipe, (input, context) =>
		handleRetryDeliveryPreflight(runtime, input, context),
	)
}

async function handleRetryDeliveryPreflight(
	runtime: CoreRuntime,
	input: Input,
	context: CommandContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const authorizedAction = prepareAuthorizedAction(runtime, context)
	if (!authorizedAction.ok) return authorizedAction

	return withTwoPhaseTransaction(runtime.services, {
		read: (storage) => readRetryPreflightPlan(storage, input),
		run: (claim) => runProviderBackedDeliveryPreflightChecks(runtime, claim.plan),
		write: (storage, claim, checks) =>
			writeDeliveryPreflightRetry(
				storage,
				input.deliveryId,
				claim.plan,
				checks,
				authorizedAction.value.stamp,
				authorizedAction.value.actionId,
			),
	})
}

async function readRetryPreflightPlan(
	storage: CoreStorage,
	input: Input,
): Promise<CoreResult<{ deliveryContext: DeliveryContext; plan: ProviderBackedDeliveryPreflightPlan }, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await requirePreflightFailedDelivery(storage, input.deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const plan = await readProviderBackedDeliveryPreflightPlan(storage, deliveryContext.value)
	return plan.ok ? { ok: true, value: { deliveryContext: deliveryContext.value, plan: plan.value } } : plan
}

async function writeDeliveryPreflightRetry(
	storage: CoreStorage,
	deliveryId: Id,
	plan: ProviderBackedDeliveryPreflightPlan,
	checks: ValidationEvidence[],
	stamp: AuditStamp,
	actionId: Id,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await requirePreflightFailedDelivery(storage, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const freshness = await providerBackedDeliveryPreflightInputsStillCurrent(storage, deliveryContext.value, plan)
	if (!freshness.ok) return freshness
	if (!freshness.value) return deliveryPreflightClaimConflict(deliveryId)

	return writePreflightAction(
		storage,
		deliveryContext.value.delivery,
		preflightAction(deliveryContext.value.delivery.id, checks, stamp, actionId),
	)
}

function deliveryPreflightClaimConflict(deliveryId: Id): CoreResult<never, DeliveryPreflightClaimConflictError> {
	return { ok: false, error: { type: 'delivery-preflight-claim-conflict', deliveryId } }
}

async function requirePreflightFailedDelivery(
	storage: CoreStorage,
	deliveryId: Id,
): Promise<CoreResult<DeliveryContext, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(storage, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const deliveryState = getDeliveryState(deliveryContext.value)
	if (!deliveryState.ok) return deliveryState

	return deliveryState.value.type === 'preflight-failed'
		? { ok: true, value: deliveryContext.value }
		: deliveryWorkStateMismatch(deliveryId, ['preflight-failed'], deliveryState.value)
}

async function writePreflightAction(
	storage: CoreStorage,
	delivery: Delivery,
	action: Action,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const putResult = await createRecord('action', storage, action)
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
		seedAgentRunProfile,
		seedDelivery,
		seedProject,
		seedSecret,
		seedSelectableModel,
		validationEvidence,
	} = await import('../utils/test-helpers')
	const { buildDeliveryContext } = await import('../utils/delivery-context')
	const { getDeliveryState } = await import('../utils/delivery-context')

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
			seedPassingAgentRunProfile(options)
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
			const deliveryContext = await buildDeliveryContext(options.tx, 'delivery-1')
			if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')
			expect(getDeliveryState(deliveryContext.value)).not.toMatchObject({
				ok: true,
				value: { type: 'preflight-failed' },
			})
		})

		it('records all failed provider-backed preflight checks on retry', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPassingAgentRunProfile(options)
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

		it('returns operation error when the selected execution Agent Run Profile is missing', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')

			expect(await retry(options)).toEqual({
				ok: false,
				error: { type: 'not-found', resource: 'agent-run-profile', id: 'agent-run-profile-1' },
			})
		})

		it('returns operation error when the Delivery Project is missing', async () => {
			const options = preflightFailedFixture()
			options.tx.projects.records.delete('project-1')

			expect(await retry(options)).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: 'project-1' } })
		})

		it('returns operation error when the selected execution Model is missing', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPassingAgentRunProfile(options)
			options.tx.models.records.delete('model-1')

			expect(await retry(options)).toEqual({ ok: false, error: { type: 'not-found', resource: 'model', id: 'model-1' } })
		})

		it('records failed evidence when the selected execution Model is archived', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedSelectableModel(options.tx, 'model-1', { modelArchived: true })
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')

			expectRetrySummary(await retry(options), 'Selected Delivery execution Model is archived.')
		})

		it('records failed evidence when the selected execution Model Provider is archived', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedSelectableModel(options.tx, 'model-1', { providerArchived: true })
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')

			expectRetrySummary(await retry(options), 'Selected Delivery execution Model Provider is archived.')
		})

		it('records failed evidence when the selected execution Agent Run Profile is archived', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1', { archived: true })

			expectRetrySummary(await retry(options), 'Selected Delivery execution Agent Run Profile is archived.')
		})

		it('returns a preflight claim conflict when provider-backed retry inputs become stale', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			const profile = seedPassingAgentRunProfile(options)
			seedSelectableModel(options.tx, 'model-2')
			seedRepository(options)
			const providers = passingProviderBackedPreflightProviders()
			providers.modelProviderProtocols.preflightModel = () => {
				profile.modelUse = { modelId: 'model-2', thinkingLevel: 'none' }
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
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1', { archived: true })
			seedRepository(options)
			staleLocalPreflightOnSecondTransaction(options, () => {
				options.tx.agentRunProfiles.records.get('agent-run-profile-1')!.archivePeriods = []
			})

			const result = await retry(options)

			expect(result).toEqual({ ok: false, error: { type: 'delivery-preflight-claim-conflict', deliveryId: 'delivery-1' } })
			expect(options.tx.actions.records.has('action-1')).toBe(false)
		})

		it('returns operation errors for storage failures instead of recording preflight evidence', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, 'project-1')
			seedPassingAgentRunProfile(options)
			seedRepository(options)
			options.tx.actions.fail.put = true

			expect(await retry(options)).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'create', resource: 'action', id: 'action-1' } },
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
		options.tx.deliveries.records.get('delivery-1')!.queued = localStamp()
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
		const session = options.storage.session.bind(options.storage)
		let calls = 0
		options.storage.session = async (fn) => {
			calls += 1
			if (calls === 2) stale()
			return session(fn)
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

	function seedPassingAgentRunProfile(options: ReturnType<typeof preflightFailedFixture>) {
		return seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')
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
