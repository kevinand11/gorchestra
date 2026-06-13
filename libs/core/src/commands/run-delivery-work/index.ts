import { v, type PipeOutput } from 'valleyed'

import { handleDeliveryWorkState } from './handlers'
import {
	deliveryArtifactCreationClaim,
	recordDeliveryArtifactCreationResult,
	type DeliveryArtifactCreationClaim,
} from './handlers/delivery-needs-artifact-creation'
import { workedActions } from './handlers/result'
import {
	recordSliceArtifactCreationResult,
	sliceArtifactCreationClaim,
	type SliceArtifactCreationClaim,
} from './handlers/slice-needs-artifact-creation'
import type { Error, Result } from './types'
import type { Action } from '../../domain/action'
import { idPipe, type OperationContext } from '../../domain/commons'
import type { DeliveryWorkState } from '../../domain/delivery'
import type { ValidationEvidence } from '../../domain/evidence'
import type { InvalidInputError } from '../../errors'
import type { SourceControlArtifactCreation } from '../../providers/source-control'
import type { CoreRuntime } from '../../runtime'
import type { CoreServices, CoreStorageTransaction } from '../../services'
import { buildCommandHandler } from '../../utils/command'
import { nextId, putRecord, runtimeRecord } from '../../utils/command-storage'
import { buildDeliveryContext, type DeliveryContext } from '../../utils/delivery-context'
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

	return plan.value.type === 'result'
		? { ok: true, value: plan.value.result }
		: runProviderBackedSchedulerWork(runtime, input.deliveryId, plan.value)
}

async function runProviderBackedSchedulerWork(
	runtime: CoreRuntime,
	deliveryId: string,
	plan: ProviderBackedSchedulerPreflightRead,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const providerChecks = await runProviderChecks(runtime, plan)
	if (!providerChecks.ok) return providerChecks

	return deliveryPreflightChecksPassed(providerChecks.value)
		? runPassedPreflightSchedulerWork(runtime, deliveryId, plan, providerChecks.value)
		: withTransaction(runtime.services, (tx) => applySchedulerPreflight(runtime.services, tx, deliveryId, plan, providerChecks.value))
}

async function runPassedPreflightSchedulerWork(
	runtime: CoreRuntime,
	deliveryId: string,
	plan: ProviderBackedSchedulerPreflightRead,
	providerChecks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const claim = readArtifactCreationClaim(plan)
	if (!claim.ok) return claim

	return claim.value === null
		? withTransaction(runtime.services, (tx) => applySchedulerPreflight(runtime.services, tx, deliveryId, plan, providerChecks))
		: runArtifactCreationClaim(runtime, deliveryId, plan, claim.value)
}

async function runArtifactCreationClaim(
	runtime: CoreRuntime,
	deliveryId: string,
	plan: ProviderBackedSchedulerPreflightRead,
	claim: ArtifactCreationClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const creation = await runArtifactCreation(runtime, claim)
	if (!creation.ok) return creation

	return withTransaction(runtime.services, (tx) =>
		applyArtifactCreationResult(runtime.services, tx, deliveryId, plan, claim, creation.value),
	)
}

type SchedulerPreflightRead = { type: 'result'; result: Result } | ProviderBackedSchedulerPreflightRead

type ProviderBackedSchedulerPreflightRead = {
	type: 'provider-backed'
	deliveryContext: DeliveryContext
	state: DeliveryWorkState
	preflightPlan: ProviderBackedDeliveryPreflightPlan
}

type ArtifactCreationClaim =
	| { type: 'delivery-artifact'; claim: DeliveryArtifactCreationClaim }
	| { type: 'slice-artifact'; claim: SliceArtifactCreationClaim }

async function readSchedulerPreflightPlan(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryId: string,
): Promise<CoreResult<SchedulerPreflightRead, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(tx, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const stateResult = getDeliveryState(deliveryContext.value)
	return stateResult.ok ? schedulerPreflightPlanForState(services, tx, deliveryContext.value, stateResult.value) : stateResult
}

async function schedulerPreflightPlanForState(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryContext: DeliveryContext,
	state: DeliveryWorkState,
): Promise<CoreResult<SchedulerPreflightRead, Exclude<Error, InvalidInputError>>> {
	if (isSchedulerPreflightState(state)) {
		const preflightPlan = await readProviderBackedDeliveryPreflightPlan(tx, deliveryContext)
		return preflightPlan.ok
			? { ok: true, value: { type: 'provider-backed', deliveryContext, state, preflightPlan: preflightPlan.value } }
			: preflightPlan
	}

	const handled = await handleDeliveryWorkState({ services, tx, deliveryContext }, state)
	return handled.ok ? { ok: true, value: { type: 'result', result: handled.value } } : handled
}

function isSchedulerPreflightState(state: DeliveryWorkState): boolean {
	return !['closed', 'unqueued', 'dependency-blocked', 'preflight-failed', 'ready-to-ship'].includes(state.type)
}

async function runProviderChecks(
	runtime: CoreRuntime,
	plan: ProviderBackedSchedulerPreflightRead,
): Promise<CoreResult<ValidationEvidence[], Exclude<Error, InvalidInputError>>> {
	return runProviderBackedDeliveryPreflightChecks(runtime, plan.preflightPlan)
}

const artifactCreationClaimReaders: Partial<
	Record<
		DeliveryWorkState['type'],
		(plan: ProviderBackedSchedulerPreflightRead) => CoreResult<ArtifactCreationClaim | null, Exclude<Error, InvalidInputError>>
	>
> = {
	'needs-artifact-creation': deliveryArtifactCreationClaimFromPlan,
	'slices-incomplete': sliceArtifactCreationClaimFromPlan,
}

function readArtifactCreationClaim(
	plan: ProviderBackedSchedulerPreflightRead,
): CoreResult<ArtifactCreationClaim | null, Exclude<Error, InvalidInputError>> {
	return artifactCreationClaimReaders[plan.state.type]?.(plan) ?? { ok: true, value: null }
}

function deliveryArtifactCreationClaimFromPlan(
	plan: ProviderBackedSchedulerPreflightRead,
): CoreResult<ArtifactCreationClaim, Exclude<Error, InvalidInputError>> {
	const handlerContext = schedulerHandlerContextFromRead(plan)
	if (!handlerContext.ok) return handlerContext

	const claim = deliveryArtifactCreationClaim(handlerContext.value)
	return claim.ok ? { ok: true, value: { type: 'delivery-artifact', claim: claim.value } } : claim
}

function sliceArtifactCreationClaimFromPlan(
	plan: ProviderBackedSchedulerPreflightRead,
): CoreResult<ArtifactCreationClaim | null, Exclude<Error, InvalidInputError>> {
	const handlerContext = schedulerHandlerContextFromRead(plan)
	if (!handlerContext.ok) return handlerContext

	const claim = sliceArtifactCreationClaim(handlerContext.value)
	return claim.ok ? { ok: true, value: claim.value === null ? null : { type: 'slice-artifact', claim: claim.value } } : claim
}

function schedulerHandlerContextFromRead(
	plan: ProviderBackedSchedulerPreflightRead,
): CoreResult<
	{ deliveryContext: DeliveryContext; workResolution: NonNullable<ReturnType<typeof providerBackedDeliveryWorkResolution>> },
	Exclude<Error, InvalidInputError>
> {
	const resolution = providerBackedDeliveryWorkResolution(plan.preflightPlan)
	return resolution === undefined
		? {
				ok: false,
				error: {
					type: 'invariant-violation',
					message: 'Delivery Work Resolution is required for scheduler-actionable Delivery work.',
				},
			}
		: { ok: true, value: { deliveryContext: plan.deliveryContext, workResolution: resolution } }
}

async function runArtifactCreation(
	runtime: CoreRuntime,
	claim: ArtifactCreationClaim,
): Promise<CoreResult<SourceControlArtifactCreation, Exclude<Error, InvalidInputError>>> {
	return claim.type === 'delivery-artifact'
		? runtime.providers.sourceControl.createDeliveryArtifact(claim.claim)
		: runtime.providers.sourceControl.createSliceArtifact(claim.claim)
}

async function applyArtifactCreationResult(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryId: string,
	plan: ProviderBackedSchedulerPreflightRead,
	claim: ArtifactCreationClaim,
	creation: SourceControlArtifactCreation,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const readiness = await schedulerPreflightWriteReadiness(tx, deliveryId, plan.preflightPlan)
	return readiness.ok ? applyReadyArtifactCreationResult(services, tx, plan, claim, creation, readiness.value) : readiness
}

function applyReadyArtifactCreationResult(
	services: CoreServices,
	tx: CoreStorageTransaction,
	plan: ProviderBackedSchedulerPreflightRead,
	claim: ArtifactCreationClaim,
	creation: SourceControlArtifactCreation,
	readiness: SchedulerPreflightWriteReadiness,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> | CoreResult<Result, Exclude<Error, InvalidInputError>> {
	return readiness.type === 'conflict'
		? deliveryClaimConflict()
		: recordFreshArtifactCreationResult(services, tx, plan, claim, creation, readiness)
}

function recordFreshArtifactCreationResult(
	services: CoreServices,
	tx: CoreStorageTransaction,
	plan: ProviderBackedSchedulerPreflightRead,
	claim: ArtifactCreationClaim,
	creation: SourceControlArtifactCreation,
	readiness: Extract<SchedulerPreflightWriteReadiness, { type: 'ready' }>,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> | CoreResult<Result, Exclude<Error, InvalidInputError>> {
	const context = resolvedSchedulerHandlerContext(services, tx, readiness.deliveryContext, plan.preflightPlan)
	return context.ok ? recordArtifactCreationResult(context.value, readiness.state, claim, creation) : context
}

function recordArtifactCreationResult(
	context: ReturnType<typeof resolvedSchedulerHandlerContext> extends CoreResult<infer TValue, unknown> ? TValue : never,
	state: DeliveryWorkState,
	claim: ArtifactCreationClaim,
	creation: SourceControlArtifactCreation,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return claim.type === 'delivery-artifact'
		? recordDeliveryArtifactCreationResult(context, state, claim.claim, creation)
		: recordSliceArtifactCreationResult(context, state, claim.claim, creation)
}

function resolvedSchedulerHandlerContext(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryContext: DeliveryContext,
	plan: ProviderBackedDeliveryPreflightPlan,
): CoreResult<
	{
		services: CoreServices
		tx: CoreStorageTransaction
		deliveryContext: DeliveryContext
		workResolution: NonNullable<ReturnType<typeof providerBackedDeliveryWorkResolution>>
	},
	Exclude<Error, InvalidInputError>
> {
	const resolution = providerBackedDeliveryWorkResolution(plan)
	return resolution === undefined
		? {
				ok: false,
				error: {
					type: 'invariant-violation',
					message: 'Delivery Work Resolution is required for scheduler-actionable Delivery work.',
				},
			}
		: { ok: true, value: { services, tx, deliveryContext, workResolution: resolution } }
}

async function applySchedulerPreflight(
	options: CoreServices,
	tx: CoreStorageTransaction,
	deliveryId: string,
	plan: ProviderBackedSchedulerPreflightRead,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const readiness = await schedulerPreflightWriteReadiness(tx, deliveryId, plan.preflightPlan)
	if (!readiness.ok) return readiness
	if (readiness.value.type === 'conflict') return deliveryClaimConflict()

	return applyCurrentSchedulerPreflight(options, tx, readiness.value.deliveryContext, readiness.value.state, plan.preflightPlan, checks)
}

type SchedulerPreflightWriteReadiness = { type: 'ready'; deliveryContext: DeliveryContext; state: DeliveryWorkState } | { type: 'conflict' }

async function schedulerPreflightWriteReadiness(
	tx: CoreStorageTransaction,
	deliveryId: string,
	plan: ProviderBackedDeliveryPreflightPlan,
): Promise<CoreResult<SchedulerPreflightWriteReadiness, Exclude<Error, InvalidInputError>>> {
	const current = await currentSchedulerPreflightState(tx, deliveryId)
	if (!current.ok) return current
	if (!isSchedulerPreflightState(current.value.state)) return schedulerPreflightConflict()

	return freshSchedulerPreflightReadiness(tx, current.value.deliveryContext, current.value.state, plan)
}

async function currentSchedulerPreflightState(
	tx: CoreStorageTransaction,
	deliveryId: string,
): Promise<CoreResult<{ deliveryContext: DeliveryContext; state: DeliveryWorkState }, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(tx, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const stateResult = getDeliveryState(deliveryContext.value)
	return stateResult.ok ? { ok: true, value: { deliveryContext: deliveryContext.value, state: stateResult.value } } : stateResult
}

async function freshSchedulerPreflightReadiness(
	tx: CoreStorageTransaction,
	deliveryContext: DeliveryContext,
	state: DeliveryWorkState,
	plan: ProviderBackedDeliveryPreflightPlan,
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
	deliveryContext: DeliveryContext,
	state: DeliveryWorkState,
	plan: ProviderBackedDeliveryPreflightPlan,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> | CoreResult<Result, Exclude<Error, InvalidInputError>> {
	return deliveryPreflightChecksPassed(checks)
		? handleDeliveryWorkState(schedulerHandlerContext(services, tx, deliveryContext, plan), state)
		: writeFailedPreflightAction(services, tx, deliveryContext.delivery.id, checks)
}

function schedulerHandlerContext(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryContext: DeliveryContext,
	plan: ProviderBackedDeliveryPreflightPlan,
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
		seedSlice,
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

		it('creates the Delivery Artifact through Source Control outside storage transactions', async () => {
			const options = providerPreflightFixture()
			const providers = passingProviderBackedPreflightProviders()
			providers.sourceControl.createDeliveryArtifact = (input) => {
				expect(options.transactionCalls()).toBe(1)
				expect(input.sourceBranch).toBe('main')
				expect(input.deliveryBranch).toBe('gorchestra/deliveries/d-ZGVsaXZlcnktMQ')
				return Promise.resolve({ ok: true, value: { type: 'passed', mode: 'created', summary: 'created' } })
			}
			const command = createRunDeliveryWorkCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.deliveryArtifacts.records.get('delivery-artifact-1')?.config).toEqual({
				type: 'source-control',
				deliveryBranch: 'gorchestra/deliveries/d-ZGVsaXZlcnktMQ',
			})
			expect(options.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'create-delivery-artifact',
				deliveryArtifactId: 'delivery-artifact-1',
			})
		})

		it('records Delivery Artifact creation provider failures', async () => {
			const options = providerPreflightFixture()
			const providers = passingProviderBackedPreflightProviders()
			providers.sourceControl.createDeliveryArtifact = () =>
				Promise.resolve({
					ok: true,
					value: {
						type: 'failed',
						reason: { type: 'source-branch-not-found', branch: 'main' },
						summary: 'GitHub artifact source branch was not found.',
					},
				})
			const command = createRunDeliveryWorkCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					processedCount: 1,
					failures: [
						{
							scope: { type: 'delivery' },
							operation: 'create-artifact',
							summary: 'GitHub artifact source branch was not found.',
						},
					],
				},
			})
			expect(options.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'record-delivery-external-operation-failure',
				evidence: {
					type: 'external-operation',
					operation: { type: 'create-artifact' },
					passed: false,
					summary: 'GitHub artifact source branch was not found.',
				},
			})
		})

		it('creates the first Slice Artifact through Source Control outside storage transactions', async () => {
			const options = providerPreflightFixture()
			seedDeliveryArtifact(options)
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			const providers = passingProviderBackedPreflightProviders()
			providers.sourceControl.createSliceArtifact = (input) => {
				expect(options.transactionCalls()).toBe(1)
				expect(input.sourceBranch).toBe('delivery-branch')
				expect(input.sliceBranch).toBe('gorchestra/deliveries/d-ZGVsaXZlcnktMQ/slices/s-c2xpY2UtMQ')
				return Promise.resolve({ ok: true, value: { type: 'passed', mode: 'created', summary: 'created' } })
			}
			const command = createRunDeliveryWorkCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.sliceArtifacts.records.get('slice-artifact-1')?.config).toEqual({
				type: 'source-control',
				sliceBranch: 'gorchestra/deliveries/d-ZGVsaXZlcnktMQ/slices/s-c2xpY2UtMQ',
			})
			expect(options.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'create-slice-artifact',
				sliceId: 'slice-1',
				sliceArtifactId: 'slice-artifact-1',
			})
		})

		it('returns claim-conflict when artifact creation state changes before writing provider results', async () => {
			const options = providerPreflightFixture()
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			const providers = passingProviderBackedPreflightProviders()
			providers.sourceControl.createDeliveryArtifact = () => {
				seedDeliveryArtifact(options)
				return Promise.resolve({ ok: true, value: { type: 'passed', mode: 'created', summary: 'created' } })
			}
			const command = createRunDeliveryWorkCommand(createTestCoreRuntime(options, { providers }))

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

	function seedDeliveryArtifact(options: ReturnType<typeof providerPreflightFixture>) {
		options.tx.deliveryArtifacts.records.set('delivery-artifact-existing', {
			id: 'delivery-artifact-existing',
			deliveryId: 'delivery-1',
			config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
			created: { at: '2026-06-10T11:00:00.000Z' },
		})
	}
}
