import { v, type PipeOutput } from 'valleyed'

import {
	deliveryArtifactCreationClaim,
	recordDeliveryArtifactCreationResult,
	type DeliveryArtifactCreationClaim,
} from './handlers/delivery-needs-artifact-creation'
import {
	deliveryArtifactValidationClaim,
	recordDeliveryArtifactValidationResult,
	type DeliveryArtifactValidationClaim,
} from './handlers/delivery-needs-artifact-validation'
import {
	recordSliceArtifactCreationResult,
	sliceArtifactCreationClaim,
	type SliceArtifactCreationClaim,
} from './handlers/slice-needs-artifact-creation'
import {
	recordSliceArtifactValidationResult,
	sliceArtifactValidationClaim,
	type SliceArtifactValidationClaim,
} from './handlers/slice-needs-artifact-validation'
import {
	recordSliceDeliveryArtifactValidationResult,
	sliceDeliveryArtifactValidationClaim,
	type SliceDeliveryArtifactValidationClaim,
} from './handlers/slice-needs-delivery-validation'
import {
	applySchedulerPreflightChecks,
	readFreshSchedulerPreflightReadiness,
	readSchedulerPreflight,
	resolvedSchedulerHandlerContext,
	runSchedulerPreflightChecks,
	schedulerHandlerContextFromClaim,
	schedulerPreflightChecksPassed,
	schedulerPreflightClaimConflict,
	type ProviderBackedSchedulerPreflightClaim,
	type ResolvedSchedulerHandlerContext,
	type SchedulerPreflightWriteReadiness,
} from './preflight'
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
import type { DeliveryContext } from '../../utils/delivery-context'
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
	const preflight = await withTransaction(runtime.services, (tx) => readSchedulerPreflight(runtime.services, tx, input.deliveryId))
	if (!preflight.ok) return preflight

	return preflight.value.type === 'result'
		? { ok: true, value: preflight.value.result }
		: runProviderBackedSchedulerWork(runtime, input.deliveryId, preflight.value)
}

async function runProviderBackedSchedulerWork(
	runtime: CoreRuntime,
	deliveryId: string,
	preflight: ProviderBackedSchedulerPreflightClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const providerChecks = await runSchedulerPreflightChecks(runtime, preflight)
	if (!providerChecks.ok) return providerChecks

	return schedulerPreflightChecksPassed(providerChecks.value)
		? runPassedPreflightSchedulerWork(runtime, deliveryId, preflight, providerChecks.value)
		: withTransaction(runtime.services, (tx) =>
				applySchedulerPreflightChecks(runtime.services, tx, deliveryId, preflight, providerChecks.value),
			)
}

async function runPassedPreflightSchedulerWork(
	runtime: CoreRuntime,
	deliveryId: string,
	preflight: ProviderBackedSchedulerPreflightClaim,
	providerChecks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const claim = readArtifactCreationClaim(preflight)
	if (!claim.ok) return claim

	return claim.value === null
		? runPassedPreflightWithoutArtifactCreation(runtime, deliveryId, preflight, providerChecks)
		: runArtifactCreationClaim(runtime, deliveryId, preflight, claim.value)
}

async function runPassedPreflightWithoutArtifactCreation(
	runtime: CoreRuntime,
	deliveryId: string,
	preflight: ProviderBackedSchedulerPreflightClaim,
	providerChecks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const validationClaim = readArtifactValidationClaim(preflight)
	if (!validationClaim.ok) return validationClaim

	return validationClaim.value === null
		? withTransaction(runtime.services, (tx) =>
				applySchedulerPreflightChecks(runtime.services, tx, deliveryId, preflight, providerChecks),
			)
		: applyArtifactValidationClaim(runtime, deliveryId, preflight, validationClaim.value)
}

function applyArtifactValidationClaim(
	runtime: CoreRuntime,
	deliveryId: string,
	preflight: ProviderBackedSchedulerPreflightClaim,
	claim: ArtifactValidationClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return withTransaction(runtime.services, (tx) => applyArtifactValidationResult(runtime.services, tx, deliveryId, preflight, claim))
}

async function runArtifactCreationClaim(
	runtime: CoreRuntime,
	deliveryId: string,
	preflight: ProviderBackedSchedulerPreflightClaim,
	claim: ArtifactCreationClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const creation = await runArtifactCreation(runtime, claim)
	if (!creation.ok) return creation

	return withTransaction(runtime.services, (tx) =>
		applyArtifactCreationResult(runtime.services, tx, deliveryId, preflight, claim, creation.value),
	)
}

type ArtifactCreationClaim =
	| { type: 'delivery-artifact'; claim: DeliveryArtifactCreationClaim }
	| { type: 'slice-artifact'; claim: SliceArtifactCreationClaim }

type ArtifactValidationClaim =
	| { type: 'delivery-artifact'; claim: DeliveryArtifactValidationClaim }
	| { type: 'slice-artifact'; claim: SliceArtifactValidationClaim }
	| { type: 'slice-delivery-artifact'; claim: SliceDeliveryArtifactValidationClaim }

const artifactCreationClaimReaders: Partial<
	Record<
		DeliveryWorkState['type'],
		(plan: ProviderBackedSchedulerPreflightClaim) => CoreResult<ArtifactCreationClaim | null, Exclude<Error, InvalidInputError>>
	>
> = {
	'needs-artifact-creation': deliveryArtifactCreationClaimFromPlan,
	'slices-incomplete': sliceArtifactCreationClaimFromPlan,
}

function readArtifactCreationClaim(
	plan: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactCreationClaim | null, Exclude<Error, InvalidInputError>> {
	return artifactCreationClaimReaders[plan.state.type]?.(plan) ?? { ok: true, value: null }
}

function deliveryArtifactCreationClaimFromPlan(
	plan: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactCreationClaim, Exclude<Error, InvalidInputError>> {
	const handlerContext = schedulerHandlerContextFromClaim(plan)
	if (!handlerContext.ok) return handlerContext

	const claim = deliveryArtifactCreationClaim(handlerContext.value)
	return claim.ok ? { ok: true, value: { type: 'delivery-artifact', claim: claim.value } } : claim
}

function sliceArtifactCreationClaimFromPlan(
	plan: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactCreationClaim | null, Exclude<Error, InvalidInputError>> {
	const handlerContext = schedulerHandlerContextFromClaim(plan)
	if (!handlerContext.ok) return handlerContext

	const claim = sliceArtifactCreationClaim(handlerContext.value)
	return claim.ok ? { ok: true, value: claim.value === null ? null : { type: 'slice-artifact', claim: claim.value } } : claim
}

const artifactValidationClaimReaders: Partial<
	Record<
		DeliveryWorkState['type'],
		(plan: ProviderBackedSchedulerPreflightClaim) => CoreResult<ArtifactValidationClaim | null, Exclude<Error, InvalidInputError>>
	>
> = {
	'needs-artifact-validation': deliveryArtifactValidationClaimFromPlan,
	'slices-incomplete': sliceValidationClaimFromPlan,
}

function readArtifactValidationClaim(
	plan: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactValidationClaim | null, Exclude<Error, InvalidInputError>> {
	return artifactValidationClaimReaders[plan.state.type]?.(plan) ?? { ok: true, value: null }
}

function deliveryArtifactValidationClaimFromPlan(plan: ProviderBackedSchedulerPreflightClaim): CoreResult<ArtifactValidationClaim, never> {
	return { ok: true, value: { type: 'delivery-artifact', claim: deliveryArtifactValidationClaim(plan) } }
}

function sliceValidationClaimFromPlan(
	plan: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactValidationClaim | null, Exclude<Error, InvalidInputError>> {
	const deliveryValidationClaim = sliceDeliveryArtifactValidationClaimFromPlan(plan)
	if (!deliveryValidationClaim.ok || deliveryValidationClaim.value !== null) return deliveryValidationClaim

	return sliceArtifactValidationClaimFromPlan(plan)
}

function sliceDeliveryArtifactValidationClaimFromPlan(
	plan: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactValidationClaim | null, Exclude<Error, InvalidInputError>> {
	const claim = sliceDeliveryArtifactValidationClaim(plan)
	return claim.ok ? { ok: true, value: claim.value === null ? null : { type: 'slice-delivery-artifact', claim: claim.value } } : claim
}

function sliceArtifactValidationClaimFromPlan(
	plan: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactValidationClaim | null, Exclude<Error, InvalidInputError>> {
	const claim = sliceArtifactValidationClaim(plan)
	return claim.ok ? { ok: true, value: claim.value === null ? null : { type: 'slice-artifact', claim: claim.value } } : claim
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
	plan: ProviderBackedSchedulerPreflightClaim,
	claim: ArtifactCreationClaim,
	creation: SourceControlArtifactCreation,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const readiness = await readFreshSchedulerPreflightReadiness(tx, deliveryId, plan)
	return readiness.ok ? applyReadyArtifactCreationResult(services, tx, plan, claim, creation, readiness.value) : readiness
}

function applyReadyArtifactCreationResult(
	services: CoreServices,
	tx: CoreStorageTransaction,
	plan: ProviderBackedSchedulerPreflightClaim,
	claim: ArtifactCreationClaim,
	creation: SourceControlArtifactCreation,
	readiness: SchedulerPreflightWriteReadiness,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> | CoreResult<Result, Exclude<Error, InvalidInputError>> {
	return readiness.type === 'conflict'
		? schedulerPreflightClaimConflict()
		: recordFreshArtifactCreationResult(services, tx, plan, claim, creation, readiness)
}

function recordFreshArtifactCreationResult(
	services: CoreServices,
	tx: CoreStorageTransaction,
	plan: ProviderBackedSchedulerPreflightClaim,
	claim: ArtifactCreationClaim,
	creation: SourceControlArtifactCreation,
	readiness: Extract<SchedulerPreflightWriteReadiness, { type: 'ready' }>,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> | CoreResult<Result, Exclude<Error, InvalidInputError>> {
	const context = resolvedSchedulerHandlerContext(services, tx, readiness.deliveryContext, plan)
	return context.ok ? recordArtifactCreationResult(context.value, readiness.state, claim, creation) : context
}

function recordArtifactCreationResult(
	context: ResolvedSchedulerHandlerContext,
	state: DeliveryWorkState,
	claim: ArtifactCreationClaim,
	creation: SourceControlArtifactCreation,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return claim.type === 'delivery-artifact'
		? recordDeliveryArtifactCreationResult(context, state, claim.claim, creation)
		: recordSliceArtifactCreationResult(context, state, claim.claim, creation)
}

async function applyArtifactValidationResult(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryId: string,
	plan: ProviderBackedSchedulerPreflightClaim,
	claim: ArtifactValidationClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const readiness = await readFreshSchedulerPreflightReadiness(tx, deliveryId, plan)
	if (!readiness.ok) return readiness
	if (readiness.value.type === 'conflict') return schedulerPreflightClaimConflict()

	const context = { services, tx, deliveryContext: readiness.value.deliveryContext }
	return recordArtifactValidationResult(context, readiness.value.state, claim)
}

function recordArtifactValidationResult(
	context: { services: CoreServices; tx: CoreStorageTransaction; deliveryContext: DeliveryContext },
	state: DeliveryWorkState,
	claim: ArtifactValidationClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> | CoreResult<Result, Exclude<Error, InvalidInputError>> {
	if (claim.type === 'delivery-artifact') return recordDeliveryArtifactValidationResult(context, state, claim.claim)
	if (claim.type === 'slice-artifact') return recordSliceArtifactValidationResult(context, state, claim.claim)

	return recordSliceDeliveryArtifactValidationResult(context, state, claim.claim)
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

		it('records no-op Slice Artifact validation after provider-backed preflight passes', async () => {
			const options = providerPreflightFixture()
			seedDeliveryArtifact(options)
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			seedSliceArtifact(options, 'slice-1')
			seedCompletedSliceExecution(options, 'slice-1')
			const command = createRunDeliveryWorkCommand(
				createTestCoreRuntime(options, { providers: passingProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'validate-slice-artifact',
				sliceId: 'slice-1',
				evidence: validationEvidence('slice-branch-validation', true, 'No Slice Artifact validation is configured.'),
			})
		})

		it('records no-op Slice Delivery Artifact validation after provider-backed preflight passes', async () => {
			const options = providerPreflightFixture()
			seedDeliveryArtifact(options)
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			seedSliceArtifact(options, 'slice-1')
			seedPromotedSlice(options, 'slice-1')
			const command = createRunDeliveryWorkCommand(
				createTestCoreRuntime(options, { providers: passingProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'validate-slice-delivery-artifact',
				sliceId: 'slice-1',
				evidence: validationEvidence('delivery-branch-validation', true, 'No Slice Delivery Artifact validation is configured.'),
			})
		})

		it('records failed provider-backed preflight instead of no-op Slice Delivery Artifact validation', async () => {
			const options = providerPreflightFixture()
			seedDeliveryArtifact(options)
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			seedSliceArtifact(options, 'slice-1')
			seedPromotedSlice(options, 'slice-1')
			const command = createRunDeliveryWorkCommand(
				createTestCoreRuntime(options, { providers: failingProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expectWorkedPreflightResult(options, result, [
				validationEvidence('repository-preflight', false, 'GitHub repository was not found.'),
				validationEvidence('model-preflight', false, 'Anthropic Messages model was not found.'),
			])
		})

		it('records no-op Delivery Artifact validation after provider-backed preflight passes', async () => {
			const options = providerPreflightFixture()
			seedCompletedDelivery(options)
			const command = createRunDeliveryWorkCommand(
				createTestCoreRuntime(options, { providers: passingProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'validate-delivery-artifact',
				evidence: validationEvidence('delivery-branch-validation', true, 'No Delivery Artifact validation is configured.'),
			})
		})

		it('records failed provider-backed preflight instead of no-op artifact validation', async () => {
			const options = providerPreflightFixture()
			seedCompletedDelivery(options)
			const command = createRunDeliveryWorkCommand(
				createTestCoreRuntime(options, { providers: failingProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expectWorkedPreflightResult(options, result, [
				validationEvidence('repository-preflight', false, 'GitHub repository was not found.'),
				validationEvidence('model-preflight', false, 'Anthropic Messages model was not found.'),
			])
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

		it('returns claim-conflict when Slice Delivery Artifact validation state changes before writing validation results', async () => {
			const options = providerPreflightFixture()
			seedDeliveryArtifact(options)
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			seedSliceArtifact(options, 'slice-1')
			seedPromotedSlice(options, 'slice-1')
			staleLocalPreflightOnSecondTransaction(options, () => {
				seedSliceDeliveryValidation(options, 'existing-slice-delivery-validation', 'slice-1')
			})
			const command = createRunDeliveryWorkCommand(
				createTestCoreRuntime(options, { providers: passingProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expectClaimConflictWithoutAction(options, result)
		})

		it('returns claim-conflict when artifact validation state changes before writing validation results', async () => {
			const options = providerPreflightFixture()
			seedCompletedDelivery(options)
			staleLocalPreflightOnSecondTransaction(options, () => {
				seedDeliveryValidation(options, 'existing-delivery-validation')
			})
			const command = createRunDeliveryWorkCommand(
				createTestCoreRuntime(options, { providers: passingProviderBackedPreflightProviders() }),
			)

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expectClaimConflictWithoutAction(options, result)
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

	function expectClaimConflictWithoutAction(options: ReturnType<typeof createTestCoreServices>, result: Awaited<ReturnType<Operation>>) {
		expect(result).toEqual({ ok: true, value: { processedCount: 0, failures: [] } })
		expect(options.tx.actions.records.has('action-1')).toBe(false)
	}

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

	function seedAction(
		tx: ReturnType<typeof providerPreflightFixture>['tx'],
		action: { id: string; at?: string; result: Action['result'] },
	) {
		tx.actions.records.set(action.id, {
			id: action.id,
			deliveryId: 'delivery-1',
			performed: { at: action.at ?? '2026-06-10T12:00:00.000Z' },
			authorized: null,
			result: action.result,
		})
	}

	function seedCompletedDelivery(options: ReturnType<typeof providerPreflightFixture>) {
		seedDeliveryArtifact(options)
		seedSlice(options.tx, 'slice-1', 'delivery-1')
		seedPromotedSlice(options, 'slice-1')
		seedSliceDeliveryValidation(options, 'slice-complete', 'slice-1')
	}

	function seedPromotedSlice(options: ReturnType<typeof providerPreflightFixture>, sliceId: string) {
		seedAction(options.tx, {
			id: 'promote-slice',
			at: '2026-06-10T12:01:00.000Z',
			result: {
				type: 'promote-slice-artifact',
				sliceId,
				evidence: {
					type: 'external-operation',
					operation: { type: 'merge-review-surface' },
					passed: true,
					summary: 'Merged.',
				},
			},
		})
	}

	function seedSliceDeliveryValidation(options: ReturnType<typeof providerPreflightFixture>, id: string, sliceId: string) {
		seedAction(options.tx, {
			id,
			at: '2026-06-10T12:02:00.000Z',
			result: {
				type: 'validate-slice-delivery-artifact',
				sliceId,
				evidence: validationEvidence('delivery-branch-validation', true, 'Valid.'),
			},
		})
	}

	function seedDeliveryValidation(options: ReturnType<typeof providerPreflightFixture>, id: string) {
		seedAction(options.tx, {
			id,
			at: '2026-06-10T12:03:00.000Z',
			result: { type: 'validate-delivery-artifact', evidence: validationEvidence('delivery-branch-validation', true, 'Valid.') },
		})
	}

	function seedSliceArtifact(options: ReturnType<typeof providerPreflightFixture>, sliceId: string) {
		options.tx.sliceArtifacts.records.set('slice-artifact-existing', {
			id: 'slice-artifact-existing',
			sliceId,
			config: { type: 'source-control', sliceBranch: 'slice-branch' },
			created: { at: '2026-06-10T11:00:00.000Z' },
		})
	}

	function seedCompletedSliceExecution(options: ReturnType<typeof providerPreflightFixture>, sliceId: string) {
		options.tx.agentRuns.records.set('agent-run-completed', {
			id: 'agent-run-completed',
			agent: { type: 'model', modelId: 'model-1' },
			purpose: { type: 'execution', deliveryId: 'delivery-1', sliceId, mode: { type: 'initial' } },
			started: { at: '2026-06-10T11:30:00.000Z' },
			completed: { at: '2026-06-10T11:40:00.000Z' },
		})
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
