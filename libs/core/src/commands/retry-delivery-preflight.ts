import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { exclusiveDeliverySchedulerClaim } from '../dispatch/claims'
import type { Action } from '../domain/action'
import { idPipe, type Id } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type {
	DeliveryPreflightClaimConflictError,
	DeliveryWorkStateMismatchError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorage } from '../services'
import { buildCommandHandler } from '../utils/command-handler'
import { createRecord, deliveryWorkStateMismatch, prepareAuthorizedAction } from '../utils/command-storage'
import { buildDeliveryContext, getDeliveryState, type DeliveryContext } from '../utils/delivery-context'
import {
	providerBackedDeliveryPreflightInputsStillCurrent,
	readProviderBackedDeliveryPreflightPlan,
	runProviderBackedDeliveryPreflightChecks,
} from '../utils/delivery-preflight'
import type { CoreRuntime } from '../utils/runtime'
import { runTwoPhase } from '../utils/two-phase'
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
 * CommandContext; a passed retry supersedes the previous failure by ordering.
 */
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createRetryDeliveryPreflightCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('retryDeliveryPreflight', retryDeliveryPreflightInputPipe, async (input, context) => {
		const authorizedAction = prepareAuthorizedAction(runtime, context)
		if (!authorizedAction.ok) return authorizedAction

		return runTwoPhase(runtime.transactions, {
			read: async ({ storage }) => {
				const deliveryContext = await requirePreflightFailedDelivery(storage, input.deliveryId)
				if (!deliveryContext.ok) return deliveryContext

				const plan = await readProviderBackedDeliveryPreflightPlan(storage, deliveryContext.value)
				return plan.ok ? { ok: true, value: { deliveryContext: deliveryContext.value, plan: plan.value } } : plan
			},
			run: (claim) => runProviderBackedDeliveryPreflightChecks(runtime, claim.plan),
			write: async ({ storage, dispatch }, claim, checks) => {
				const deliveryContext = await requirePreflightFailedDelivery(storage, input.deliveryId)
				if (!deliveryContext.ok) return deliveryContext

				const freshness = await providerBackedDeliveryPreflightInputsStillCurrent(storage, deliveryContext.value, claim.plan)
				if (!freshness.ok) return freshness
				if (!freshness.value) {
					return { ok: false, error: { type: 'delivery-preflight-claim-conflict', deliveryId: input.deliveryId } }
				}

				const action: Action = {
					id: authorizedAction.value.actionId,
					deliveryId: deliveryContext.value.delivery.id,
					performed: { at: authorizedAction.value.stamp.at },
					authorized: authorizedAction.value.stamp,
					result: { type: 'validate-preflight', checks },
				}
				const putResult = await createRecord('action', storage, action)
				if (!putResult.ok) return putResult
				if (checks.every((check) => check.passed)) {
					const accepted = await dispatch.request({
						payload: { type: 'delivery-work-scheduler', deliveryId: input.deliveryId },
						reason: { type: 'delivery-work-requested' },
						coordinationClaims: [exclusiveDeliverySchedulerClaim(input.deliveryId)],
						deduplicationKey: { type: 'delivery-work-scheduler', deliveryId: input.deliveryId },
					})
					if (!accepted.ok) return accepted
				}
				return { ok: true, value: { delivery: deliveryContext.value.delivery, action } }
			},
		})
	})
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
			seedDelivery(options.tx, '01k00000000000000000000008')
			const command = createRetryDeliveryPreflightCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: '01k00000000000000000000008' }, context)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'delivery-work-state-mismatch',
					deliveryId: '01k00000000000000000000008',
					expected: ['preflight-failed'],
					actual: { type: 'unqueued' },
				},
			})
		})

		it('records a passing preflight retry Action that clears preflight-failed Work State', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, '01k00000000000000000000030')
			seedPassingAgentRunProfile(options)
			seedRepository(options)
			const command = createRetryDeliveryPreflightCommand(
				createTestCoreRuntime(options, { providers: passingProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: '01k00000000000000000000008' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					delivery: options.tx.deliveries.records.get('01k00000000000000000000008'),
					action: expectedPassingProviderPreflightAction('01k00000000000000000010001'),
				},
			})
			const deliveryContext = await buildDeliveryContext(options.tx, '01k00000000000000000000008')
			if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')
			expect(getDeliveryState(deliveryContext.value)).not.toMatchObject({
				ok: true,
				value: { type: 'preflight-failed' },
			})
			expect([...options.tx.dispatchRequests.records.values()].map((request) => request.payload)).toEqual([
				{ type: 'delivery-work-scheduler', deliveryId: '01k00000000000000000000008' },
			])
		})

		it('records all failed provider-backed preflight checks on retry', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, '01k00000000000000000000030')
			seedPassingAgentRunProfile(options)
			seedRepository(options)
			const command = createRetryDeliveryPreflightCommand(
				createTestCoreRuntime(options, { providers: failingProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: '01k00000000000000000000008' }, context)

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
			expect(options.tx.dispatchRequests.records).toHaveLength(0)
		})

		it('returns operation error when the selected execution Agent Run Profile is missing', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, '01k00000000000000000000030')

			expect(await retry(options)).toEqual({
				ok: false,
				error: { type: 'not-found', resource: 'agent-run-profile', id: '01k00000000000000000000006' },
			})
		})

		it('returns operation error when the Delivery Project is missing', async () => {
			const options = preflightFailedFixture()
			options.tx.projects.records.delete('01k00000000000000000000030')

			expect(await retry(options)).toEqual({
				ok: false,
				error: { type: 'not-found', resource: 'project', id: '01k00000000000000000000030' },
			})
		})

		it('returns operation error when the selected execution Model is missing', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, '01k00000000000000000000030')
			seedPassingAgentRunProfile(options)
			options.tx.models.records.delete('01k00000000000000000000024')

			expect(await retry(options)).toEqual({
				ok: false,
				error: { type: 'not-found', resource: 'model', id: '01k00000000000000000000024' },
			})
		})

		it('records failed evidence when the selected execution Model is archived', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, '01k00000000000000000000030')
			seedSelectableModel(options.tx, '01k00000000000000000000024', { modelArchived: true })
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')

			expectRetrySummary(await retry(options), 'Selected Delivery execution Model is archived.')
		})

		it('records failed evidence when the selected execution Model Provider is archived', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, '01k00000000000000000000030')
			seedSelectableModel(options.tx, '01k00000000000000000000024', { providerArchived: true })
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')

			expectRetrySummary(await retry(options), 'Selected Delivery execution Model Provider is archived.')
		})

		it('records failed evidence when the selected execution Agent Run Profile is archived', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, '01k00000000000000000000030')
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024', { archived: true })

			expectRetrySummary(await retry(options), 'Selected Delivery execution Agent Run Profile is archived.')
		})

		it('returns a preflight claim conflict when provider-backed retry inputs become stale', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, '01k00000000000000000000030')
			const profile = seedPassingAgentRunProfile(options)
			seedSelectableModel(options.tx, '01k00000000000000000000026')
			seedRepository(options)
			const providers = passingProviderBackedPreflightProviders()
			providers.modelProviderProtocols.preflightModel = () => {
				profile.modelUse = { modelId: '01k00000000000000000000026', thinkingLevel: 'none' }
				return Promise.resolve({ ok: true, value: { type: 'passed', summary: 'Anthropic Messages model preflight passed.' } })
			}
			const command = createRetryDeliveryPreflightCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ deliveryId: '01k00000000000000000000008' }, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'delivery-preflight-claim-conflict', deliveryId: '01k00000000000000000000008' },
			})
			expect(options.tx.actions.records.has('01k00000000000000000010001')).toBe(false)
		})

		it('returns a preflight claim conflict when local retry inputs become stale', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, '01k00000000000000000000030')
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024', { archived: true })
			seedRepository(options)
			staleLocalPreflightOnSecondTransaction(options, () => {
				options.tx.agentRunProfiles.records.get('01k00000000000000000000006')!.archivePeriods = []
			})

			const result = await retry(options)

			expect(result).toEqual({
				ok: false,
				error: { type: 'delivery-preflight-claim-conflict', deliveryId: '01k00000000000000000000008' },
			})
			expect(options.tx.actions.records.has('01k00000000000000000010001')).toBe(false)
		})

		it('returns operation errors for storage failures instead of recording preflight evidence', async () => {
			const options = preflightFailedFixture()
			seedProject(options.tx, '01k00000000000000000000030')
			seedPassingAgentRunProfile(options)
			seedRepository(options)
			options.tx.actions.fail.put = true

			expect(await retry(options)).toEqual({
				ok: false,
				error: {
					type: 'storage-operation-failed',
					operation: { type: 'create', resource: 'action', id: '01k00000000000000000010001' },
				},
			})
		})
	})

	async function expectMissingDelivery(command: Operation) {
		expect(await command({ deliveryId: '01k00000000000000000010019' }, context)).toEqual({
			ok: false,
			error: { type: 'not-found', resource: 'delivery', id: '01k00000000000000000010019' },
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
		seedDelivery(options.tx, '01k00000000000000000000008')
		options.tx.deliveries.records.get('01k00000000000000000000008')!.queued = localStamp()
		options.tx.actions.records.set('preflight-failed', {
			id: 'preflight-failed',
			deliveryId: '01k00000000000000000000008',
			performed: { at: '2026-06-10T00:01:00.000Z' },
			authorized: localStamp(),
			result: { type: 'validate-preflight', checks: [validationEvidence('delivery-preflight', false, 'Missing config.')] },
		})

		return options
	}

	async function retry(options: ReturnType<typeof preflightFailedFixture>) {
		return createRetryDeliveryPreflightCommand(
			createTestCoreRuntime(options, { providers: passingProviderBackedPreflightProviders() }),
		)({ deliveryId: '01k00000000000000000000008' }, context)
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
		seedSecret(options.tx, '01k00000000000000000000040')
		options.tx.repositories.records.set('01k00000000000000000000034', {
			id: '01k00000000000000000000034',
			projectId: '01k00000000000000000000030',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: '01k00000000000000000000040' },
			created: localStamp(),
		})
	}

	function seedPassingAgentRunProfile(options: ReturnType<typeof preflightFailedFixture>) {
		return seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
	}

	function expectRetrySummary(result: CoreResult<Result, Error>, summary: string) {
		expect(result).toMatchObject({ ok: true, value: { action: expectedPreflightAction('01k00000000000000000010001', false, summary) } })
	}

	function expectedPassingProviderPreflightAction(id: string): Action {
		return {
			id,
			deliveryId: '01k00000000000000000000008',
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
			deliveryId: '01k00000000000000000000008',
			performed: { at: '2026-06-10T12:00:00.000Z' },
			authorized: localStamp(),
			result: { type: 'validate-preflight', checks: [validationEvidence('delivery-preflight', passed, summary)] },
		}
	}
}
