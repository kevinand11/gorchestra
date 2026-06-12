import { actionPipe, type Action } from '../domain/action'
import { agentRunPipe, type AgentRun } from '../domain/agent-run'
import { deliveryArtifactPipe, sliceArtifactPipe, type DeliveryArtifact, type SliceArtifact } from '../domain/artifact'
import { portfolioConfigRecordPipe, type PortfolioConfigRecord, type ProjectConfigRecord } from '../domain/config'
import { deliveryPipe, type Delivery, type DeliveryWorkState } from '../domain/delivery'
import { linkPipe, type Link } from '../domain/graph'
import { projectPipe, type Project } from '../domain/project'
import { repositoryPipe, type Repository } from '../domain/repository'
import { reviewSurfacePipe, type ReviewSurface } from '../domain/review-surface'
import { slicePipe, type Slice, type SliceWorkState } from '../domain/slice'
import type { InvalidCoreServiceOutputError, InvariantViolationError, StorageOperationFailedError } from '../errors'
import type { CoreStorageTransaction } from '../services'
import { validateCoreServiceOutput } from '../validation'
import { getRequired, listRecords } from './storage'
import type { Result } from './types'
import { deriveDeliveryWorkState, deriveSliceWorkState } from './work-state'
import type { WorkStateDerivationError } from './work-state/types'

export interface SliceStateSummary {
	slice: Slice
	state: SliceWorkState
}

export interface StoredDeliveryWorkContext {
	phase: 'stored'
	delivery: Delivery
	project: Project
	repository: Repository
	portfolioConfig: PortfolioConfigRecord | null
	projectConfig: ProjectConfigRecord | null
	slices: Slice[]
	links: Link[]
	actions: Action[]
	agentRuns: AgentRun[]
	deliveryArtifacts: DeliveryArtifact[]
	sliceArtifacts: SliceArtifact[]
	reviewSurfaces: ReviewSurface[]
	deliveryState: DeliveryWorkState
	sliceStates?: SliceStateSummary[]
}

export type StoredDeliveryWorkContextError = WorkStateDerivationError

export async function buildStoredDeliveryWorkContext(
	tx: CoreStorageTransaction,
	deliveryId: Delivery['id'],
): Promise<Result<StoredDeliveryWorkContext, StoredDeliveryWorkContextError>> {
	const root = await readStoredDeliveryWorkRoot(tx, deliveryId)
	if (!root.ok) return root

	const records = await readStoredDeliveryWorkRecords(tx)
	if (!records.ok) return records

	const deliveryState = await deriveDeliveryWorkState(tx, deliveryId)
	if (!deliveryState.ok) return deliveryState

	return storedDeliveryWorkContext(
		root.value,
		records.value,
		deliveryState.value,
		await sliceStatesForDelivery(tx, records.value.slices, deliveryId),
	)
}

interface StoredDeliveryWorkRoot {
	delivery: Delivery
	project: Project
	repository: Repository
	portfolioConfig: PortfolioConfigRecord | null
	projectConfig: ProjectConfigRecord | null
}

interface StoredDeliveryWorkRecords {
	slices: Slice[]
	links: Link[]
	actions: Action[]
	agentRuns: AgentRun[]
	deliveryArtifacts: DeliveryArtifact[]
	sliceArtifacts: SliceArtifact[]
	reviewSurfaces: ReviewSurface[]
}

async function readStoredDeliveryWorkRoot(
	tx: CoreStorageTransaction,
	deliveryId: Delivery['id'],
): Promise<Result<StoredDeliveryWorkRoot, StoredDeliveryWorkContextError>> {
	const delivery = await getRequired('delivery', tx.deliveries, deliveryId, deliveryPipe)
	return delivery.ok ? readStoredDeliveryWorkRootForDelivery(tx, delivery.value) : delivery
}

async function readStoredDeliveryWorkRootForDelivery(
	tx: CoreStorageTransaction,
	delivery: Delivery,
): Promise<Result<StoredDeliveryWorkRoot, StoredDeliveryWorkContextError>> {
	const [project, repository, portfolioConfig] = await Promise.all([
		getRequired('project', tx.projects, delivery.projectId, projectPipe),
		getRequired('repository', tx.repositories, delivery.target.repositoryId, repositoryPipe),
		readOptionalPortfolioConfig(tx),
	])
	const failure = firstFailure([project, repository, portfolioConfig])
	if (failure !== null) return failure

	const projectRecord = resultValue(project)
	const repositoryRecord = resultValue(repository)
	const projectBoundary = repositoryProjectBoundary(projectRecord, repositoryRecord)
	return projectBoundary.ok
		? { ok: true, value: storedDeliveryWorkRoot(delivery, projectRecord, repositoryRecord, resultValue(portfolioConfig)) }
		: projectBoundary
}

function storedDeliveryWorkRoot(
	delivery: Delivery,
	project: Project,
	repository: Repository,
	portfolioConfig: PortfolioConfigRecord | null,
): StoredDeliveryWorkRoot {
	return { delivery, project, repository, portfolioConfig, projectConfig: project.config }
}

function repositoryProjectBoundary(project: Project, repository: Repository): Result<void, InvariantViolationError> {
	return repository.projectId === project.id
		? { ok: true, value: undefined }
		: {
				ok: false,
				error: { type: 'invariant-violation', message: `Repository ${repository.id} is outside Project ${project.id}.` },
			}
}

async function readOptionalPortfolioConfig(
	tx: CoreStorageTransaction,
): Promise<Result<PortfolioConfigRecord | null, StorageOperationFailedError | InvalidCoreServiceOutputError>> {
	try {
		const record = await tx.portfolioConfig.get()
		if (record === null) return { ok: true, value: null }

		return validateCoreServiceOutput(portfolioConfigRecordPipe, record, 'storage', 'get-singleton:portfolio-config')
	} catch {
		return {
			ok: false,
			error: { type: 'storage-operation-failed', operation: { type: 'get-singleton', resource: 'portfolio-config' } },
		}
	}
}

async function readStoredDeliveryWorkRecords(
	tx: CoreStorageTransaction,
): Promise<Result<StoredDeliveryWorkRecords, StoredDeliveryWorkContextError>> {
	const records = await readStoredDeliveryWorkRecordResults(tx)
	const failure = firstFailure(records)
	return failure ?? okStoredDeliveryWorkRecords(records)
}

function okStoredDeliveryWorkRecords(
	records: Awaited<ReturnType<typeof readStoredDeliveryWorkRecordResults>>,
): Result<StoredDeliveryWorkRecords, StoredDeliveryWorkContextError> {
	const [slices, links, actions, agentRuns, deliveryArtifacts, sliceArtifacts, reviewSurfaces] = records
	return {
		ok: true,
		value: {
			slices: resultValue(slices),
			links: resultValue(links),
			actions: resultValue(actions),
			agentRuns: resultValue(agentRuns),
			deliveryArtifacts: resultValue(deliveryArtifacts),
			sliceArtifacts: resultValue(sliceArtifacts),
			reviewSurfaces: resultValue(reviewSurfaces),
		},
	}
}

async function readStoredDeliveryWorkRecordResults(tx: CoreStorageTransaction) {
	return Promise.all([
		listRecords('slice', tx.slices, slicePipe),
		listRecords('link', tx.links, linkPipe),
		listRecords('action', tx.actions, actionPipe),
		listRecords('agent-run', tx.agentRuns, agentRunPipe),
		listRecords('delivery-artifact', tx.deliveryArtifacts, deliveryArtifactPipe),
		listRecords('slice-artifact', tx.sliceArtifacts, sliceArtifactPipe),
		listRecords('review-surface', tx.reviewSurfaces, reviewSurfacePipe),
	] as const)
}

async function sliceStatesForDelivery(
	tx: CoreStorageTransaction,
	slices: Slice[],
	deliveryId: Delivery['id'],
): Promise<Result<SliceStateSummary[], StoredDeliveryWorkContextError>> {
	const summaries: SliceStateSummary[] = []
	for (const slice of deliverySlices(slices, deliveryId)) {
		const state = await deriveSliceWorkState(tx, slice.id)
		if (!state.ok) return state
		summaries.push({ slice, state: state.value })
	}

	return { ok: true, value: summaries }
}

function firstFailure<TError>(results: ReadonlyArray<Result<unknown, TError>>): Result<never, TError> | null {
	const failure = results.find((result) => !result.ok)
	return failure === undefined || failure.ok ? null : failure
}

function resultValue<TValue>(result: Result<TValue, unknown>): TValue {
	if (!result.ok) throw new Error('Expected result value after checking for failures.')

	return result.value
}

function deliverySlices(slices: Slice[], deliveryId: Delivery['id']): Slice[] {
	return slices
		.filter((slice) => slice.deliveryId === deliveryId)
		.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

function storedDeliveryWorkContext(
	root: StoredDeliveryWorkRoot,
	records: StoredDeliveryWorkRecords,
	deliveryState: DeliveryWorkState,
	sliceStates: Result<SliceStateSummary[], StoredDeliveryWorkContextError>,
): Result<StoredDeliveryWorkContext, StoredDeliveryWorkContextError> {
	if (!sliceStates.ok) return sliceStates

	return {
		ok: true,
		value: { phase: 'stored', ...root, ...records, deliveryState, sliceStates: sliceStates.value },
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, localStamp, seedDelivery, seedProject, seedSecret, seedSlice } = await import('./test-helpers')

	describe('buildStoredDeliveryWorkContext', () => {
		it('loads root-level Delivery work facts and derives unqueued state', async () => {
			const options = storedContextFixture()

			const result = await buildStoredDeliveryWorkContext(options.tx, 'delivery-1')

			expect(result).toMatchObject({ ok: true, value: { phase: 'stored', deliveryState: { type: 'unqueued' } } })
			if (result.ok) {
				expect(result.value.delivery.id).toBe('delivery-1')
				expect(result.value.project.id).toBe('project-1')
				expect(result.value.repository.id).toBe('repository-1')
			}
		})

		it('includes Slice Work States in Delivery order', async () => {
			const options = storedContextFixture()
			seedSlice(options.tx, 'slice-2', 'delivery-1')
			seedSlice(options.tx, 'slice-1', 'delivery-1')

			const result = await buildStoredDeliveryWorkContext(options.tx, 'delivery-1')

			expect(result).toMatchObject({
				ok: true,
				value: {
					sliceStates: [
						{ slice: { id: 'slice-2' }, state: { type: 'needs-artifact-creation' } },
						{ slice: { id: 'slice-1' }, state: { type: 'needs-artifact-creation' } },
					],
				},
			})
		})

		it('returns an invariant violation when the target Repository is outside the Delivery Project', async () => {
			const options = storedContextFixture()
			options.tx.repositories.records.get('repository-1')!.projectId = 'other-project'

			const result = await buildStoredDeliveryWorkContext(options.tx, 'delivery-1')

			expect(result).toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Repository repository-1 is outside Project project-1.' },
			})
		})
	})

	function storedContextFixture() {
		const options = createTestCoreServices()
		seedProject(options.tx, 'project-1')
		seedDelivery(options.tx, 'delivery-1')
		seedSecret(options.tx, 'secret-1')
		options.tx.repositories.records.set('repository-1', {
			id: 'repository-1',
			projectId: 'project-1',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
			created: localStamp(),
		})
		return options
	}
}
