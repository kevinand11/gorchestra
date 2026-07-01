import { v, type PipeOutput } from 'valleyed'

import type { Action } from '../../domain/action'
import { idPipe, type OperationContext } from '../../domain/commons'
import type { ValidationEvidence } from '../../domain/evidence'
import type { InvalidInputError } from '../../errors'
import type { CoreRuntime } from '../../runtime'
import { withTransaction } from '../../storage/helpers'
import type { Result as CoreResult } from '../../utils/types'
import { buildCommandHandler } from '../utils/handler'
import { handleDeliveryNeedsArtifactCreation } from './handlers/delivery-needs-artifact-creation'
import { handleDeliveryNeedsReviewSurface } from './handlers/delivery-needs-review-surface'
import { handleDeliverySlicesIncomplete } from './handlers/delivery-slices-incomplete'
import {
	applySchedulerPreflightChecks,
	readSchedulerPreflight,
	runSchedulerPreflightChecks,
	schedulerHandlerContextFromClaim,
	schedulerPreflightChecksPassed,
	type ProviderBackedSchedulerPreflightClaim,
} from './preflight'
import type { Error, Result } from './types'

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
	const preflight = await withTransaction(runtime.services, (storage) => readSchedulerPreflight(runtime, storage, input.deliveryId))
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
		: withTransaction(runtime.services, (storage) =>
				applySchedulerPreflightChecks(runtime, storage, deliveryId, preflight, providerChecks.value),
			)
}

async function runPassedPreflightSchedulerWork(
	runtime: CoreRuntime,
	deliveryId: string,
	preflight: ProviderBackedSchedulerPreflightClaim,
	providerChecks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const artifactCreation = await handleArtifactCreation(runtime, preflight)
	if (artifactCreation !== null) return artifactCreation
	const reviewSurfaceCreation = await handleReviewSurfaceCreation(runtime, preflight)
	if (reviewSurfaceCreation !== null) return reviewSurfaceCreation
	if (preflight.state.type === 'slices-incomplete') return handleSliceWorkPool(runtime, preflight)

	return withTransaction(runtime.services, (storage) =>
		applySchedulerPreflightChecks(runtime, storage, deliveryId, preflight, providerChecks),
	)
}

function handleSliceWorkPool(
	runtime: CoreRuntime,
	preflight: ProviderBackedSchedulerPreflightClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> | CoreResult<Result, Exclude<Error, InvalidInputError>> {
	const context = schedulerHandlerContextFromClaim(preflight)
	return context.ok
		? handleDeliverySlicesIncomplete(runtime, {
				services: runtime.services,
				storage: runtime.services.storage,
				values: runtime.values,
				...context.value,
			})
		: context
}

function handleArtifactCreation(
	runtime: CoreRuntime,
	preflight: ProviderBackedSchedulerPreflightClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>> | null> | CoreResult<Result, Exclude<Error, InvalidInputError>> | null {
	return preflight.state.type === 'needs-artifact-creation' ? handleDeliveryNeedsArtifactCreation(runtime, preflight) : null
}

function handleReviewSurfaceCreation(
	runtime: CoreRuntime,
	preflight: ProviderBackedSchedulerPreflightClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>> | null> | CoreResult<Result, Exclude<Error, InvalidInputError>> | null {
	return preflight.state.type === 'needs-review-surface' ? handleDeliveryNeedsReviewSurface(runtime, preflight) : null
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

		it('creates the Delivery Artifact through Source Control outside storage transactions', async () => {
			const options = providerPreflightFixture()
			const providers = passingProviderBackedPreflightProviders()
			providers.sourceControl.createArtifactBranch = (input) => {
				expect(options.transactionCalls()).toBe(1)
				expect(input.sourceBranch).toBe('main')
				expect(input.artifactBranch).toBe('gorchestra/deliveries/d-ZGVsaXZlcnktMQ')
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
			providers.sourceControl.createArtifactBranch = () =>
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
			providers.sourceControl.createArtifactBranch = (input) => {
				expect(options.transactionCalls()).toBe(2)
				expect(input.sourceBranch).toBe('delivery-branch')
				expect(input.artifactBranch).toBe('gorchestra/deliveries/d-ZGVsaXZlcnktMQ/slices/s-c2xpY2UtMQ')
				return Promise.resolve({ ok: true, value: { type: 'passed', mode: 'created', summary: 'created' } })
			}
			const command = createRunDeliveryWorkCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 2, failures: [] } })
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

			expect(result).toEqual({ ok: true, value: { processedCount: 2, failures: [] } })
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

		it('creates a Delivery Review Surface through Source Control outside storage transactions', async () => {
			const options = providerPreflightFixture()
			seedCompletedDelivery(options)
			seedDeliveryValidation(options)
			const providers = passingProviderBackedPreflightProviders()
			providers.sourceControl.createReviewSurface = (input) => {
				expect(options.transactionCalls()).toBe(1)
				expect(input.sourceBranch).toBe('delivery-branch')
				expect(input.targetBranch).toBe('main')
				expect(input.title).toBe('Delivery')
				return Promise.resolve({
					ok: true,
					value: { type: 'review-surface', mode: 'created', pullRequestNumber: 12, summary: 'created' },
				})
			}
			const command = createRunDeliveryWorkCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.reviewSurfaces.records.get('review-surface-1')?.scope).toEqual({
				type: 'delivery',
				deliveryId: 'delivery-1',
				deliveryArtifactId: 'delivery-artifact-existing',
			})
			expect(options.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'create-delivery-review-surface',
				reviewSurfaceId: 'review-surface-1',
			})
		})

		it('records observed Delivery Artifact integration when Review Surface creation finds integrated branches', async () => {
			const options = providerPreflightFixture()
			seedCompletedDelivery(options)
			seedDeliveryValidation(options)
			const providers = passingProviderBackedPreflightProviders()
			providers.sourceControl.createReviewSurface = () =>
				Promise.resolve({ ok: true, value: { type: 'integrated', summary: 'Already integrated.' } })
			const command = createRunDeliveryWorkCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'observe-delivery-artifact-integration',
				evidence: {
					type: 'external-operation',
					operation: { type: 'observe-artifact-integration' },
					passed: true,
					summary: 'Already integrated.',
				},
			})
		})

		it('creates a Slice Review Surface through Source Control outside storage transactions', async () => {
			const options = providerPreflightFixture()
			seedDeliveryArtifact(options)
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			seedSliceArtifact(options, 'slice-1')
			seedCompletedSliceExecution(options, 'slice-1')
			seedSliceArtifactValidation(options, 'slice-1')
			const providers = passingProviderBackedPreflightProviders()
			providers.sourceControl.createReviewSurface = (input) => {
				expect(options.transactionCalls()).toBe(2)
				expect(input.sourceBranch).toBe('slice-branch')
				expect(input.targetBranch).toBe('delivery-branch')
				expect(input.title).toBe('Slice')
				return Promise.resolve({
					ok: true,
					value: { type: 'review-surface', mode: 'created', pullRequestNumber: 13, summary: 'created' },
				})
			}
			const command = createRunDeliveryWorkCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.reviewSurfaces.records.get('review-surface-1')?.scope).toEqual({
				type: 'slice',
				sliceId: 'slice-1',
				sliceArtifactId: 'slice-artifact-existing',
			})
			expect(options.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'create-slice-review-surface',
				sliceId: 'slice-1',
				reviewSurfaceId: 'review-surface-1',
			})
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

	function seedDeliveryValidation(options: ReturnType<typeof providerPreflightFixture>) {
		seedAction(options.tx, {
			id: 'delivery-validation',
			at: '2026-06-10T12:03:00.000Z',
			result: {
				type: 'validate-delivery-artifact',
				evidence: validationEvidence('delivery-branch-validation', true, 'Valid.'),
			},
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
			agent: { type: 'model' },
			purpose: { type: 'execution', deliveryId: 'delivery-1', sliceId, mode: { type: 'initial' } },
			started: { at: '2026-06-10T11:30:00.000Z' },
			completed: { at: '2026-06-10T11:40:00.000Z' },
		})
	}

	function seedSliceArtifactValidation(options: ReturnType<typeof providerPreflightFixture>, sliceId: string) {
		seedAction(options.tx, {
			id: 'slice-artifact-validation',
			at: '2026-06-10T11:50:00.000Z',
			result: {
				type: 'validate-slice-artifact',
				sliceId,
				evidence: validationEvidence('slice-branch-validation', true, 'Valid.'),
			},
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
