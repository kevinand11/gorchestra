import { noEligibleWork } from './result'
import { handleSliceWorkState } from './slice'
import { handleSliceNeedsArtifactCreation } from './slice-needs-artifact-creation'
import { handleSliceNeedsReviewSurface } from './slice-needs-review-surface'
import type { Id } from '../../../domain/commons'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { InvalidInputError } from '../../../errors'
import type { CoreRuntime } from '../../../runtime'
import type { CoreStorage } from '../../../services'
import { withTransaction } from '../../../storage/helpers'
import { buildDeliveryContext, getDeliveryState, getSliceState, resolveDeliveryWork } from '../../../utils/delivery-context'
import type { Result as CoreResult } from '../../../utils/types'
import type { DeliveryWorkResolution, Error, ResolvedDeliveryHandlerContext, Result, RunDeliveryWorkHandlerResult } from '../types'

interface SliceStateCandidate {
	slice: Slice
	state: ActionableSliceWorkState
	order: number
	priority: SliceActionPriority
	key: string
}

export interface SliceWorkOperationCandidate {
	slice: Slice
	state: ActionableSliceWorkState
	key: string
}

interface SliceWorkSelection {
	deliveryContext: ResolvedDeliveryHandlerContext['deliveryContext']
	slice: Slice
	state: ActionableSliceWorkState
	key: string
}

export type ActionableSliceWorkState = Extract<
	SliceWorkState,
	{ type: 'needs-delivery-validation' | 'needs-artifact-validation' | 'needs-review-surface' | 'needs-artifact-creation' | 'executable' }
>

type SliceActionPriority = 0 | 1 | 2 | 3 | 4

interface SliceWorkerPool {
	runtime: CoreRuntime
	deliveryId: Id
	workResolution: DeliveryWorkResolution
	repositoryAccessSecret: ResolvedDeliveryHandlerContext['repositoryAccessSecret']
	claimedKeys: Set<string>
}

export function selectActionableSliceWorkOperationCandidates(
	deliveryContext: ResolvedDeliveryHandlerContext['deliveryContext'],
	limit: number,
): CoreResult<SliceWorkOperationCandidate[], Exclude<Error, InvalidInputError>> {
	const candidates = actionableSliceCandidates(deliveryContext, new Set())
	return candidates.ok
		? { ok: true, value: candidates.value.slice(0, Math.max(0, limit)).map((candidate) => sliceWorkOperationCandidate(candidate)) }
		: candidates
}

function sliceWorkOperationCandidate(candidate: SliceStateCandidate): SliceWorkOperationCandidate {
	return { slice: candidate.slice, state: candidate.state, key: candidate.key }
}

export async function handleDeliverySlicesIncomplete(
	runtime: CoreRuntime,
	context: Pick<
		ResolvedDeliveryHandlerContext,
		'services' | 'storage' | 'values' | 'deliveryContext' | 'workResolution' | 'repositoryAccessSecret'
	>,
): Promise<RunDeliveryWorkHandlerResult> {
	const pool: SliceWorkerPool = {
		runtime,
		deliveryId: context.deliveryContext.delivery.id,
		workResolution: context.workResolution,
		repositoryAccessSecret: context.repositoryAccessSecret,
		claimedKeys: new Set(),
	}
	const slotCount = context.workResolution.workConfig.maxProcessableSliceSlots
	const slots = Array.from({ length: slotCount }, () => runSliceWorkerSlot(pool))
	const results = await Promise.all(slots)

	return combineSliceWorkerResults(results)
}

async function runSliceWorkerSlot(pool: SliceWorkerPool): Promise<RunDeliveryWorkHandlerResult> {
	let processedCount = 0
	const failures: Result['failures'] = []

	while (true) {
		const result = await runNextSliceWork(pool)
		if (!result.ok) return result
		if (result.value === null) return { ok: true, value: { processedCount, failures } }

		processedCount += result.value.processedCount
		failures.push(...result.value.failures)
	}
}

async function runNextSliceWork(pool: SliceWorkerPool): Promise<CoreResult<Result | null, Exclude<Error, InvalidInputError>>> {
	const selection = await selectNextSliceWork(pool)
	if (!selection.ok) return selection
	if (selection.value === null) return { ok: true, value: null }

	return processSliceSelection(pool, selection.value)
}

async function selectNextSliceWork(
	pool: SliceWorkerPool,
): Promise<CoreResult<SliceWorkSelection | null, Exclude<Error, InvalidInputError>>> {
	return withTransaction(pool.runtime.services, async (storage) => readSliceWorkSelection(storage, pool))
}

async function readSliceWorkSelection(
	storage: CoreStorage,
	pool: SliceWorkerPool,
): Promise<CoreResult<SliceWorkSelection | null, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(storage, pool.deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	return selectFromDeliveryContext(deliveryContext.value, pool.claimedKeys)
}

function selectFromDeliveryContext(
	deliveryContext: ResolvedDeliveryHandlerContext['deliveryContext'],
	claimedKeys: Set<string>,
): CoreResult<SliceWorkSelection | null, Exclude<Error, InvalidInputError>> {
	const deliveryState = getDeliveryState(deliveryContext)
	if (!deliveryState.ok) return deliveryState
	if (deliveryState.value.type !== 'slices-incomplete') return { ok: true, value: null }

	return selectFirstActionableSlice(deliveryContext, claimedKeys)
}

function selectFirstActionableSlice(
	deliveryContext: ResolvedDeliveryHandlerContext['deliveryContext'],
	claimedKeys: Set<string>,
): CoreResult<SliceWorkSelection | null, Exclude<Error, InvalidInputError>> {
	const candidate = firstActionableSlice(deliveryContext, claimedKeys)
	if (!candidate.ok) return candidate
	if (candidate.value === null) return { ok: true, value: null }

	claimedKeys.add(candidate.value.key)
	return { ok: true, value: sliceWorkSelection(deliveryContext, candidate.value) }
}

function sliceWorkSelection(
	deliveryContext: ResolvedDeliveryHandlerContext['deliveryContext'],
	candidate: SliceStateCandidate,
): SliceWorkSelection {
	return { deliveryContext, slice: candidate.slice, state: candidate.state, key: candidate.key }
}

function firstActionableSlice(
	deliveryContext: ResolvedDeliveryHandlerContext['deliveryContext'],
	claimedKeys: Set<string>,
): CoreResult<SliceStateCandidate | null, Exclude<Error, InvalidInputError>> {
	const candidates = actionableSliceCandidates(deliveryContext, claimedKeys)
	return candidates.ok ? { ok: true, value: candidates.value[0] ?? null } : candidates
}

function actionableSliceCandidates(
	deliveryContext: ResolvedDeliveryHandlerContext['deliveryContext'],
	claimedKeys: Set<string>,
): CoreResult<SliceStateCandidate[], Exclude<Error, InvalidInputError>> {
	const candidates: SliceStateCandidate[] = []
	for (const [order, deliverySlice] of deliveryContext.slices.entries()) {
		const state = getSliceState(deliveryContext, deliverySlice.slice.id)
		if (!state.ok) return state

		const candidate = sliceStateCandidate(deliverySlice.slice, state.value, order, claimedKeys)
		if (candidate !== null) candidates.push(candidate)
	}

	return { ok: true, value: candidates.sort(compareSliceCandidates) }
}

function sliceStateCandidate(slice: Slice, state: SliceWorkState, order: number, claimedKeys: Set<string>): SliceStateCandidate | null {
	const priority = sliceActionPriority(state)
	if (priority === null) return null

	const actionableState = state as ActionableSliceWorkState
	const key = sliceOperationKey(slice.id, actionableState)
	return claimedKeys.has(key) ? null : { slice, state: actionableState, order, priority, key }
}

function sliceActionPriority(state: SliceWorkState): SliceActionPriority | null {
	switch (state.type) {
		case 'needs-delivery-validation':
			return 0
		case 'needs-artifact-validation':
			return 1
		case 'needs-review-surface':
			return 2
		case 'needs-artifact-creation':
			return 3
		case 'executable':
			return 4
		case 'complete':
		case 'operation-running':
		case 'operation-queued':
		case 'dependency-blocked':
		case 'correction-blocked':
		case 'awaiting-review':
		case 'slice-operation-failed':
			return null
		default:
			throw new Error(`Unexpected Slice Work State: ${String(state satisfies never)}`)
	}
}

function compareSliceCandidates(left: SliceStateCandidate, right: SliceStateCandidate): number {
	return left.priority - right.priority || left.order - right.order
}

function sliceOperationKey(sliceId: Id, state: ActionableSliceWorkState): string {
	return `${sliceId}:${state.type}:${sliceOperationKeyDetail(state)}`
}

function sliceOperationKeyDetail(state: ActionableSliceWorkState): string {
	switch (state.type) {
		case 'needs-artifact-validation':
			return state.sliceArtifactId
		case 'needs-delivery-validation':
			return state.actionId
		case 'needs-review-surface':
			return state.sliceArtifactId
		case 'needs-artifact-creation':
			return 'current'
		case 'executable':
			return executableKeyDetail(state)
		default:
			throw new Error(`Unexpected actionable Slice Work State: ${String(state satisfies never)}`)
	}
}

function executableKeyDetail(state: Extract<ActionableSliceWorkState, { type: 'executable' }>): string {
	return state.mode === 'correction' ? `correction:${state.failureChain.rootActionId}` : 'current'
}

async function processSliceSelection(pool: SliceWorkerPool, selection: SliceWorkSelection): Promise<RunDeliveryWorkHandlerResult> {
	if (selection.state.type === 'needs-artifact-creation') {
		return handleSliceNeedsArtifactCreation(pool.runtime, selectionContext(pool, selection), selection.slice, selection.state)
	}
	if (selection.state.type === 'needs-review-surface') {
		return handleSliceNeedsReviewSurface(pool.runtime, selectionContext(pool, selection), selection.slice, selection.state)
	}

	return withTransaction(pool.runtime.services, async (storage) =>
		handleSliceWorkState(
			{ services: pool.runtime.services, storage, values: pool.runtime.values, deliveryContext: selection.deliveryContext },
			selection.slice,
			selection.state,
			pool.workResolution,
		),
	)
}

function selectionContext(
	pool: SliceWorkerPool,
	selection: SliceWorkSelection,
): Pick<ResolvedDeliveryHandlerContext, 'deliveryContext' | 'workResolution' | 'repositoryAccessSecret'> {
	return {
		deliveryContext: selection.deliveryContext,
		workResolution: pool.workResolution,
		repositoryAccessSecret: pool.repositoryAccessSecret,
	}
}

function combineSliceWorkerResults(results: RunDeliveryWorkHandlerResult[]): RunDeliveryWorkHandlerResult {
	const failed = results.find((result) => !result.ok)
	if (failed !== undefined) return failed

	return completedSliceWorkerResult(successfulSliceWorkerResults(results))
}

function successfulSliceWorkerResults(results: RunDeliveryWorkHandlerResult[]): Result[] {
	return results.flatMap((result) => (result.ok ? [result.value] : []))
}

function completedSliceWorkerResult(results: Result[]): RunDeliveryWorkHandlerResult {
	const processedCount = results.reduce((total, result) => total + result.processedCount, 0)
	const failures = results.flatMap((result) => result.failures)
	return processedCount === 0 && failures.length === 0 ? noEligibleWork() : { ok: true, value: { processedCount, failures } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { buildDeliveryContext } = await import('../../../utils/delivery-context')
	const {
		createTestCoreRuntime,
		createTestCoreServices,
		localStamp,
		passingProviderBackedPreflightProviders,
		defaultDeliveryWorkConfig,
		seedAgentRunProfile,
		seedDelivery,
		seedProject,
		seedSelectableModel,
		seedSlice,
		stamp,
	} = await import('../../../utils/test-helpers')

	describe('handleDeliverySlicesIncomplete', () => {
		it('claims executable Slice work up to configured slots in Delivery slice order', async () => {
			const options = executableDeliveryFixture({ maxProcessableSliceSlots: 3 })
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			seedSlice(options.tx, 'slice-2', 'delivery-1')
			seedSlice(options.tx, 'slice-3', 'delivery-1')
			seedSliceArtifact(options.tx, 'slice-1')
			seedSliceArtifact(options.tx, 'slice-2')
			seedSliceArtifact(options.tx, 'slice-3')

			const result = await handleDeliverySlicesIncomplete(createTestCoreRuntime(options), await handlerContext(options))

			expect(result).toEqual({ ok: true, value: { processedCount: 3, failures: [] } })
			expect([...options.tx.agentRuns.records.values()].map((run) => run.purpose)).toEqual([
				{ type: 'execution', deliveryId: 'delivery-1', sliceId: 'slice-1', mode: { type: 'initial' } },
				{ type: 'execution', deliveryId: 'delivery-1', sliceId: 'slice-2', mode: { type: 'initial' } },
				{ type: 'execution', deliveryId: 'delivery-1', sliceId: 'slice-3', mode: { type: 'initial' } },
			])
		})

		it('prioritizes non-Agent Slice work before executable Slice work', async () => {
			const options = executableDeliveryFixture({ maxProcessableSliceSlots: 3 })
			seedSlice(options.tx, 'slice-delivery-validation', 'delivery-1')
			seedSlice(options.tx, 'slice-artifact-validation', 'delivery-1')
			seedSlice(options.tx, 'slice-artifact-creation', 'delivery-1')
			seedSlice(options.tx, 'slice-executable', 'delivery-1')
			seedSliceArtifact(options.tx, 'slice-delivery-validation')
			seedSliceArtifact(options.tx, 'slice-artifact-validation')
			seedSliceArtifact(options.tx, 'slice-executable')
			seedPromotion(options.tx, 'slice-delivery-validation')
			seedCompletedSliceExecution(options.tx, 'slice-artifact-validation')

			expect(await handleDeliverySlicesIncomplete(createArtifactRuntime(options), await handlerContext(options))).toEqual({
				ok: true,
				value: { processedCount: 6, failures: [] },
			})
			expect(
				[...options.tx.actions.records.values()]
					.map((action) => action.result.type)
					.filter((type) => type !== 'promote-slice-artifact')
					.slice(0, 3),
			).toEqual(['validate-slice-delivery-artifact', 'validate-slice-artifact', 'create-slice-artifact'])
			expect([...options.tx.agentRuns.records.values()].map(executionSliceId)).toContain('slice-executable')
		})

		it('returns no-eligible-work when no Slice is actionable', async () => {
			const options = executableDeliveryFixture()

			expect(await handleDeliverySlicesIncomplete(createTestCoreRuntime(options), await handlerContext(options))).toEqual({
				ok: true,
				value: { processedCount: 0, failures: [] },
			})
		})
	})

	function executionSliceId(run: { purpose: { type: string; sliceId?: string } }) {
		if (run.purpose.type !== 'execution' || run.purpose.sliceId === undefined) throw new Error('Expected execution Agent Run.')
		return run.purpose.sliceId
	}

	function createArtifactRuntime(options: ReturnType<typeof executableDeliveryFixture>) {
		const providers = passingProviderBackedPreflightProviders()
		providers.sourceControl.createArtifactBranch = () =>
			Promise.resolve({ ok: true, value: { type: 'passed', mode: 'created', summary: 'created' } })
		return createTestCoreRuntime(options, { providers })
	}

	async function handlerContext(options: ReturnType<typeof executableDeliveryFixture>): Promise<ResolvedDeliveryHandlerContext> {
		const deliveryContext = await buildDeliveryContext(options.tx, 'delivery-1')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')
		const workResolution = await resolveDeliveryWork(options.tx, deliveryContext.value)
		if (!workResolution.ok || workResolution.value.type !== 'passed') throw new Error('Expected Delivery Work Resolution.')

		return {
			services: options,
			storage: options.tx,
			values: options.values,
			tx: options.tx,
			deliveryContext: deliveryContext.value,
			workResolution: workResolution.value.resolution,
			repositoryAccessSecret: { secretId: 'secret-1', valueRef: 'protected-ref' },
		}
	}

	function executableDeliveryFixture(options: { workConfig?: boolean; maxProcessableSliceSlots?: number } = {}) {
		const core = createTestCoreServices()
		seedSelectableModel(core.tx, 'model-1')
		seedProject(core.tx, 'project-1', defaultDeliveryWorkConfig('agent-run-profile-1'))
		seedDelivery(core.tx, 'delivery-1')
		seedQueuedDelivery(core.tx)
		seedDeliveryArtifact(core.tx)
		if (options.workConfig !== false) {
			seedAgentRunProfile(core.tx, 'agent-run-profile-1', 'model-1')
			core.tx.projects.records.get('project-1')!.config.value.work.maxProcessableSliceSlots = options.maxProcessableSliceSlots ?? 1
		}

		return core
	}

	function seedQueuedDelivery(tx: ReturnType<typeof executableDeliveryFixture>['tx']) {
		tx.deliveries.records.get('delivery-1')!.queued = localStamp()
	}

	function seedDeliveryArtifact(tx: ReturnType<typeof executableDeliveryFixture>['tx']) {
		tx.deliveryArtifacts.records.set('delivery-artifact-1', {
			id: 'delivery-artifact-1',
			deliveryId: 'delivery-1',
			config: { type: 'source-control', deliveryBranch: 'delivery' },
			created: stamp,
		})
	}

	function seedSliceArtifact(tx: ReturnType<typeof executableDeliveryFixture>['tx'], sliceId: string) {
		tx.sliceArtifacts.records.set(`${sliceId}-artifact`, {
			id: `${sliceId}-artifact`,
			sliceId,
			config: { type: 'source-control', sliceBranch: `${sliceId}-branch` },
			created: stamp,
		})
	}

	function seedPromotion(tx: ReturnType<typeof executableDeliveryFixture>['tx'], sliceId: string) {
		tx.actions.records.set('promote-slice', {
			id: 'promote-slice',
			deliveryId: 'delivery-1',
			performed: { at: '2026-06-10T11:20:00.000Z' },
			authorized: null,
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

	function seedCompletedSliceExecution(tx: ReturnType<typeof executableDeliveryFixture>['tx'], sliceId: string) {
		tx.agentRuns.records.set(`${sliceId}-agent-run`, {
			id: `${sliceId}-agent-run`,
			agent: { type: 'model' },
			purpose: { type: 'execution', deliveryId: 'delivery-1', sliceId, mode: { type: 'initial' } },
			profile: {
				agentRunProfileId: 'agent-run-profile-1',
				name: 'Agent Run Profile',
				modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
			},
			modelUseOverride: null,
			started: { at: '2026-06-10T11:30:00.000Z' },
			completed: { at: '2026-06-10T11:40:00.000Z' },
		})
	}
}
