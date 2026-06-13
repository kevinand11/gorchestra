import { v, type PipeOutput } from 'valleyed'

import { handleDeliveryWorkState } from './handlers'
import { workedActions } from './handlers/result'
import type { Error, Result } from './types'
import type { Action } from '../../domain/action'
import { idPipe, type OperationContext } from '../../domain/commons'
import type { DeliveryWorkState } from '../../domain/delivery'
import type { ValidationEvidence } from '../../domain/evidence'
import type { InvalidInputError } from '../../errors'
import type { CoreRuntime } from '../../runtime'
import type { CoreServices, CoreStorageTransaction } from '../../services'
import { buildCommandHandler } from '../../utils/command'
import { nextId, putRecord, runtimeRecord } from '../../utils/command-storage'
import { buildStoredDeliveryContext, type StoredDeliveryContext } from '../../utils/delivery-context'
import { getDeliveryState } from '../../utils/delivery-context'
import {
	deliveryPreflightChecksPassed,
	providerBackedDeliveryPreflightInputsStillCurrent,
	providerBackedDeliveryWorkResolution,
	readProviderBackedDeliveryPreflightPlan,
	runProviderBackedDeliveryPreflightChecks,
	type ProviderBackedDeliveryPreflightPlan,
} from '../../utils/delivery-preflight'
import { withTransaction } from '../../utils/storage'
import type { Result as CoreResult } from '../../utils/types'

export type { Error, Result, RunDeliveryWorkFailure, RunDeliveryWorkFailureOperation, RunDeliveryWorkNoObservedChangeTarget } from './types'

const runDeliveryWorkInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof runDeliveryWorkInputPipe>

/**
 * Performs one bounded scheduler step for one available processing slot. It does
 * not wait for Agent Runs, review, human input, or other asynchronous external
 * state. Delivery preflight runs before every bounded scheduler-actionable pass.
 * Successful external operations that change or observe authoritative Delivery
 * state produce Actions; failed external operations that produce evidence are
 * recorded as failure Actions. Scheduling loops should skip non-schedulable
 * Deliveries and refetch Delivery/Slice state before each pass.
 */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createRunDeliveryWorkCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('runDeliveryWork', runDeliveryWorkInputPipe, (input) => handleRunDeliveryWork(runtime, input))
}

async function handleRunDeliveryWork(runtime: CoreRuntime, input: Input): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const plan = await withTransaction(runtime.services, (tx) => readSchedulerPreflightPlan(runtime.services, tx, input.deliveryId))
	if (!plan.ok) return plan

	const preflightPlan = plan.value
	if (preflightPlan.type === 'result') return { ok: true, value: preflightPlan.result }

	const providerChecks = await runProviderChecks(runtime, preflightPlan)
	if (!providerChecks.ok) return providerChecks

	return withTransaction(runtime.services, (tx) =>
		applySchedulerPreflight(runtime.services, tx, input.deliveryId, preflightPlan, providerChecks.value),
	)
}

type SchedulerPreflightRead = { type: 'result'; result: Result } | ProviderBackedDeliveryPreflightPlan

async function readSchedulerPreflightPlan(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryId: string,
): Promise<CoreResult<SchedulerPreflightRead, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildStoredDeliveryContext(tx, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const stateResult = getDeliveryState(deliveryContext.value)
	return stateResult.ok ? schedulerPreflightPlanForState(services, tx, deliveryContext.value, stateResult.value) : stateResult
}

async function schedulerPreflightPlanForState(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryContext: StoredDeliveryContext,
	state: DeliveryWorkState,
): Promise<CoreResult<SchedulerPreflightRead, Exclude<Error, InvalidInputError>>> {
	if (isSchedulerPreflightState(state)) return readProviderBackedDeliveryPreflightPlan(tx, deliveryContext)

	const handled = await handleDeliveryWorkState({ services, tx, deliveryContext }, state)
	return handled.ok ? { ok: true, value: { type: 'result', result: handled.value } } : handled
}

function isSchedulerPreflightState(state: DeliveryWorkState): boolean {
	return !['closed', 'unqueued', 'dependency-blocked', 'preflight-failed', 'ready-to-ship'].includes(state.type)
}

async function runProviderChecks(
	runtime: CoreRuntime,
	plan: Exclude<SchedulerPreflightRead, { type: 'result' }>,
): Promise<CoreResult<ValidationEvidence[], Exclude<Error, InvalidInputError>>> {
	return runProviderBackedDeliveryPreflightChecks(runtime, plan)
}

async function applySchedulerPreflight(
	options: CoreServices,
	tx: CoreStorageTransaction,
	deliveryId: string,
	plan: Exclude<SchedulerPreflightRead, { type: 'result' }>,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const readiness = await schedulerPreflightWriteReadiness(tx, deliveryId, plan)
	if (!readiness.ok) return readiness
	if (readiness.value.type === 'conflict') return deliveryClaimConflict()

	return applyCurrentSchedulerPreflight(options, tx, readiness.value.deliveryContext, readiness.value.state, plan, checks)
}

type SchedulerPreflightWriteReadiness =
	| { type: 'ready'; deliveryContext: StoredDeliveryContext; state: DeliveryWorkState }
	| { type: 'conflict' }

async function schedulerPreflightWriteReadiness(
	tx: CoreStorageTransaction,
	deliveryId: string,
	plan: Exclude<SchedulerPreflightRead, { type: 'result' }>,
): Promise<CoreResult<SchedulerPreflightWriteReadiness, Exclude<Error, InvalidInputError>>> {
	const current = await currentSchedulerPreflightState(tx, deliveryId)
	if (!current.ok) return current
	if (!isSchedulerPreflightState(current.value.state)) return schedulerPreflightConflict()

	return freshSchedulerPreflightReadiness(tx, current.value.deliveryContext, current.value.state, plan)
}

async function currentSchedulerPreflightState(
	tx: CoreStorageTransaction,
	deliveryId: string,
): Promise<CoreResult<{ deliveryContext: StoredDeliveryContext; state: DeliveryWorkState }, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildStoredDeliveryContext(tx, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const stateResult = getDeliveryState(deliveryContext.value)
	return stateResult.ok ? { ok: true, value: { deliveryContext: deliveryContext.value, state: stateResult.value } } : stateResult
}

async function freshSchedulerPreflightReadiness(
	tx: CoreStorageTransaction,
	deliveryContext: StoredDeliveryContext,
	state: DeliveryWorkState,
	plan: Exclude<SchedulerPreflightRead, { type: 'result' }>,
): Promise<CoreResult<SchedulerPreflightWriteReadiness, Exclude<Error, InvalidInputError>>> {
	const freshness = await providerBackedDeliveryPreflightInputsStillCurrent(tx, deliveryContext, plan)
	if (!freshness.ok) return freshness

	return freshness.value ? { ok: true, value: { type: 'ready', deliveryContext, state } } : schedulerPreflightConflict()
}

function schedulerPreflightConflict(): CoreResult<Extract<SchedulerPreflightWriteReadiness, { type: 'conflict' }>, never> {
	return { ok: true, value: { type: 'conflict' } }
}

function applyCurrentSchedulerPreflight(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryContext: StoredDeliveryContext,
	state: DeliveryWorkState,
	plan: Exclude<SchedulerPreflightRead, { type: 'result' }>,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> | CoreResult<Result, Exclude<Error, InvalidInputError>> {
	return deliveryPreflightChecksPassed(checks)
		? handleDeliveryWorkState(schedulerHandlerContext(services, tx, deliveryContext, plan), state)
		: writeFailedPreflightAction(services, tx, deliveryContext.delivery.id, checks)
}

function schedulerHandlerContext(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryContext: StoredDeliveryContext,
	plan: Exclude<SchedulerPreflightRead, { type: 'result' }>,
) {
	const resolution = providerBackedDeliveryWorkResolution(plan)
	return resolution === undefined ? { services, tx, deliveryContext } : { services, tx, deliveryContext, workResolution: resolution }
}

function deliveryClaimConflict(): CoreResult<Result, never> {
	return { ok: true, value: { processedCount: 0, failures: [] } }
}

async function writeFailedPreflightAction(
	options: CoreServices,
	tx: CoreStorageTransaction,
	deliveryId: string,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const actionId = nextId(options, 'action')
	if (!actionId.ok) return actionId

	const performed = runtimeRecord(options)
	if (!performed.ok) return performed

	const action: Action = {
		id: actionId.value,
		deliveryId,
		performed: performed.value,
		authorized: null,
		result: { type: 'validate-preflight', checks },
	}
	const put = await putRecord('action', tx.actions, action.id, action)
	if (!put.ok) return put

	return workedActions([action.id])
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const {
		context,
		createTestCoreRuntime,
		createTestCoreServices,
		failingProviderBackedPreflightProviders,
		localStamp,
		neverCalledProviderBackedPreflightProviders,
		passingProviderBackedPreflightProviders,
		seedDelivery,
		seedProject,
		seedSecret,
		seedSelectableModel,
		validationEvidence,
	} = await import('../../utils/test-helpers')

	describe('runDeliveryWork command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			const command = createRunDeliveryWorkCommand(createTestCoreRuntime(options))

			const result = await command({} as never, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'runDeliveryWork' } })
			expect(options.transactionCalls()).toBe(0)
		})

		it('records all failed provider-backed Delivery preflight checks before scheduler work', async () => {
			const options = providerPreflightFixture()
			const command = createRunDeliveryWorkCommand(
				createTestCoreRuntime(options, { providers: failingProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.actions.records.get('action-1')).toEqual({
				id: 'action-1',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: {
					type: 'validate-preflight',
					checks: [
						validationEvidence('repository-preflight', false, 'GitHub repository was not found.'),
						validationEvidence('model-preflight', false, 'Anthropic Messages model was not found.'),
					],
				},
			})
		})

		it('records independent local Repository and Model Provider Secret readiness failures together', async () => {
			const options = providerPreflightFixture()
			options.tx.repositories.records.get('repository-1')!.config.secretId = 'missing-repository-secret'
			options.tx.models.records.get('model-1')!.providerId = 'model-provider-with-missing-secret'
			options.tx.modelProviders.records.set('model-provider-with-missing-secret', {
				id: 'model-provider-with-missing-secret',
				name: 'Provider',
				protocol: 'anthropic-messages',
				baseUrl: 'https://api.example.com',
				auth: { type: 'apiKey', secretId: 'missing-model-secret' },
				headers: [],
				created: localStamp(),
				updated: null,
				archivePeriods: [],
			})
			const command = createRunDeliveryWorkCommand(
				createTestCoreRuntime(options, { providers: neverCalledProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expectWorkedPreflightResult(options, result, [
				validationEvidence('repository-preflight', false, 'GitHub repository access Secret is missing.'),
				validationEvidence('model-preflight', false, 'Anthropic Messages model provider auth Secret is missing.'),
			])
		})

		it('returns operation errors instead of recording partial preflight checks', async () => {
			const options = providerPreflightFixture()
			const providers = failingProviderBackedPreflightProviders()
			providers.modelProviderProtocols.preflightModel = () =>
				Promise.resolve({
					ok: false,
					error: {
						type: 'invalid-core-service-output',
						service: 'secrets',
						operation: 'resolveSecretValues',
						pipeError: null as never,
					},
				})
			const command = createRunDeliveryWorkCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'secrets', operation: 'resolveSecretValues', pipeError: null },
			})
			expect(options.tx.actions.records.has('action-1')).toBe(false)
		})

		it('does not call providers for non-scheduler-actionable Deliveries', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, 'delivery-1')
			const command = createRunDeliveryWorkCommand(
				createTestCoreRuntime(options, { providers: neverCalledProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 0, failures: [] } })
		})

		it('records failed preflight evidence when Delivery Work Config is unresolved', async () => {
			const options = providerPreflightFixture()
			options.tx.portfolioConfig.record!.value.work = null
			const command = createRunDeliveryWorkCommand(
				createTestCoreRuntime(options, { providers: neverCalledProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expectWorkedPreflightResult(options, result, [
				validationEvidence('delivery-preflight', false, 'Delivery Work Config is not resolved.'),
			])
		})

		it('returns claim-conflict when local preflight failure inputs become stale before evidence is written', async () => {
			const options = providerPreflightFixture()
			const resolvedWorkConfig = options.tx.portfolioConfig.record!.value.work
			options.tx.portfolioConfig.record!.value.work = null
			staleLocalPreflightOnSecondTransaction(options, () => {
				options.tx.portfolioConfig.record!.value.work = resolvedWorkConfig
			})
			const command = createRunDeliveryWorkCommand(
				createTestCoreRuntime(options, { providers: neverCalledProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 0, failures: [] } })
			expect(options.tx.actions.records.has('action-1')).toBe(false)
		})

		it('returns claim-conflict when preflight inputs change before scheduler work is written', async () => {
			const options = providerPreflightFixture()
			seedSelectableModel(options.tx, 'model-2')
			const providers = passingProviderBackedPreflightProviders()
			providers.modelProviderProtocols.preflightModel = () => {
				options.tx.portfolioConfig.record!.value.model.defaultModelId = 'model-2'
				return Promise.resolve({ ok: true, value: { type: 'passed', summary: 'Anthropic Messages model preflight passed.' } })
			}
			const command = createRunDeliveryWorkCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 0, failures: [] } })
			expect(options.tx.actions.records.has('action-1')).toBe(false)
		})
	})

	function expectWorkedPreflightResult(
		options: ReturnType<typeof createTestCoreServices>,
		result: Awaited<ReturnType<Operation>>,
		checks: ReturnType<typeof validationEvidence>[],
	) {
		expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
		expect(options.tx.actions.records.get('action-1')?.result).toEqual({ type: 'validate-preflight', checks })
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

	function providerPreflightFixture() {
		const options = createTestCoreServices()
		seedProject(options.tx, 'project-1')
		seedDelivery(options.tx, 'delivery-1')
		seedSecret(options.tx, 'secret-1')
		seedSelectableModel(options.tx, 'model-1')
		options.tx.repositories.records.set('repository-1', {
			id: 'repository-1',
			projectId: 'project-1',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
			created: localStamp(),
		})
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
				work: { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
			},
		}
		options.tx.deliveries.records.get('delivery-1')!.queued = localStamp()

		return options
	}
}
