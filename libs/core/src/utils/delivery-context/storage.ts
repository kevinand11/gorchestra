import type { DeliveryDependencySummary, StoredDeliveryContext, StoredDeliverySlice } from './types'
import { compareActions } from './work-state/actions'
import type { DeliveryDependencyLink, SliceDependencyLink, WorkStateDerivationError } from './work-state/types'
import { actionPipe, type Action } from '../../domain/action'
import { agentRunPipe, type AgentRun } from '../../domain/agent-run'
import { deliveryArtifactPipe, sliceArtifactPipe, type DeliveryArtifact, type SliceArtifact } from '../../domain/artifact'
import type { ArchivePeriod, Id } from '../../domain/commons'
import { portfolioConfigRecordPipe, type PortfolioConfigRecord, type ProjectConfigRecord } from '../../domain/config'
import { deliveryPipe, type Delivery } from '../../domain/delivery'
import { linkPipe, type Link } from '../../domain/graph'
import { projectPipe, type Project } from '../../domain/project'
import { repositoryPipe, type Repository } from '../../domain/repository'
import { reviewSurfacePipe, type ReviewSurface } from '../../domain/review-surface'
import { slicePipe, type Slice } from '../../domain/slice'
import type { InvalidCoreServiceOutputError, InvariantViolationError, StorageOperationFailedError } from '../../errors'
import type { CoreStorageTransaction } from '../../services'
import { validateCoreServiceOutput } from '../../validation'
import { getRequired, listRecords, notFound } from '../storage'
import type { Result } from '../types'

export type DeliveryContextError = WorkStateDerivationError

export async function buildStoredDeliveryContext(
	tx: CoreStorageTransaction,
	deliveryId: Delivery['id'],
): Promise<Result<StoredDeliveryContext, DeliveryContextError>> {
	const root = await readDeliveryContextRoot(tx, deliveryId)
	if (!root.ok) return root

	const records = await readDeliveryContextRecords(tx)
	if (!records.ok) return records

	return deliveryContext(root.value, scopedDeliveryContextRecords(root.value.delivery, records.value))
}

interface DeliveryContextRoot {
	delivery: Delivery
	project: Project
	repository: Repository
	portfolioConfig: PortfolioConfigRecord | null
	projectConfig: ProjectConfigRecord | null
}

interface DeliveryContextRecords {
	slices: Slice[]
	links: Link[]
	actions: Action[]
	agentRuns: AgentRun[]
	deliveries: Delivery[]
	deliveryArtifacts: DeliveryArtifact[]
	sliceArtifacts: SliceArtifact[]
	reviewSurfaces: ReviewSurface[]
}

interface ScopedDeliveryContextRecords {
	deliveryArtifact: DeliveryArtifact | null
	slices: StoredDeliverySlice[]
	actions: Action[]
	agentRuns: AgentRun[]
	reviewSurfaces: ReviewSurface[]
	deliveryDependencies: DeliveryDependencySummary[]
}

async function readDeliveryContextRoot(
	tx: CoreStorageTransaction,
	deliveryId: Delivery['id'],
): Promise<Result<DeliveryContextRoot, DeliveryContextError>> {
	const delivery = await getRequired('delivery', tx.deliveries, deliveryId, deliveryPipe)
	return delivery.ok ? readDeliveryContextRootForDelivery(tx, delivery.value) : delivery
}

async function readDeliveryContextRootForDelivery(
	tx: CoreStorageTransaction,
	delivery: Delivery,
): Promise<Result<DeliveryContextRoot, DeliveryContextError>> {
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
		? { ok: true, value: deliveryContextRoot(delivery, projectRecord, repositoryRecord, resultValue(portfolioConfig)) }
		: projectBoundary
}

function deliveryContextRoot(
	delivery: Delivery,
	project: Project,
	repository: Repository,
	portfolioConfig: PortfolioConfigRecord | null,
): DeliveryContextRoot {
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

async function readDeliveryContextRecords(tx: CoreStorageTransaction): Promise<Result<DeliveryContextRecords, DeliveryContextError>> {
	const records = await readDeliveryContextRecordResults(tx)
	const failure = firstFailure(records)
	return failure ?? okDeliveryContextRecords(records)
}

function okDeliveryContextRecords(
	records: Awaited<ReturnType<typeof readDeliveryContextRecordResults>>,
): Result<DeliveryContextRecords, DeliveryContextError> {
	const [slices, links, actions, agentRuns, deliveries, deliveryArtifacts, sliceArtifacts, reviewSurfaces] = records
	return {
		ok: true,
		value: {
			slices: resultValue(slices),
			links: resultValue(links),
			actions: resultValue(actions).sort(compareActions),
			agentRuns: resultValue(agentRuns),
			deliveries: resultValue(deliveries),
			deliveryArtifacts: resultValue(deliveryArtifacts),
			sliceArtifacts: resultValue(sliceArtifacts),
			reviewSurfaces: resultValue(reviewSurfaces),
		},
	}
}

async function readDeliveryContextRecordResults(tx: CoreStorageTransaction) {
	return Promise.all([
		listRecords('slice', tx.slices, slicePipe),
		listRecords('link', tx.links, linkPipe),
		listRecords('action', tx.actions, actionPipe),
		listRecords('agent-run', tx.agentRuns, agentRunPipe),
		listRecords('delivery', tx.deliveries, deliveryPipe),
		listRecords('delivery-artifact', tx.deliveryArtifacts, deliveryArtifactPipe),
		listRecords('slice-artifact', tx.sliceArtifacts, sliceArtifactPipe),
		listRecords('review-surface', tx.reviewSurfaces, reviewSurfacePipe),
	] as const)
}

function scopedDeliveryContextRecords(
	delivery: Delivery,
	records: DeliveryContextRecords,
): Result<ScopedDeliveryContextRecords, DeliveryContextError> {
	const orderedSlices = deliverySlices(delivery, records.slices)
	const sliceIds = new Set(orderedSlices.map((slice) => slice.id))
	const dependencies = deliveryDependencies(delivery, records)
	if (!dependencies.ok) return dependencies
	const deliveryArtifact = singleDeliveryArtifact(delivery, records.deliveryArtifacts)
	if (!deliveryArtifact.ok) return deliveryArtifact
	const slices = storedDeliverySlices(orderedSlices, records)
	if (!slices.ok) return slices

	return {
		ok: true,
		value: {
			deliveryArtifact: deliveryArtifact.value,
			slices: slices.value,
			actions: records.actions.filter((action) => action.deliveryId === delivery.id),
			agentRuns: records.agentRuns.filter((run) => agentRunReferencesDelivery(run, delivery.id)),
			reviewSurfaces: records.reviewSurfaces.filter((reviewSurface) =>
				reviewSurfaceReferencesDelivery(reviewSurface, delivery.id, sliceIds),
			),
			deliveryDependencies: dependencies.value,
		},
	}
}

function deliverySlices(delivery: Delivery, slices: Slice[]): Slice[] {
	return slices
		.filter((slice) => slice.deliveryId === delivery.id)
		.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

function singleDeliveryArtifact(
	delivery: Delivery,
	artifacts: DeliveryArtifact[],
): Result<DeliveryArtifact | null, InvariantViolationError> {
	const matching = artifacts.filter((artifact) => artifact.deliveryId === delivery.id)
	return singleArtifact(matching, `Delivery ${delivery.id} has multiple Delivery Artifacts.`)
}

function storedDeliverySlices(slices: Slice[], records: DeliveryContextRecords): Result<StoredDeliverySlice[], DeliveryContextError> {
	const stored: StoredDeliverySlice[] = []
	for (const slice of slices) {
		const artifact = singleSliceArtifact(slice, records.sliceArtifacts)
		if (!artifact.ok) return artifact
		stored.push({ slice, artifact: artifact.value, dependencyLinks: sliceDependencyLinks(slice.id, records.links) })
	}

	return { ok: true, value: stored }
}

function singleSliceArtifact(slice: Slice, artifacts: SliceArtifact[]): Result<SliceArtifact | null, InvariantViolationError> {
	const matching = artifacts.filter((artifact) => artifact.sliceId === slice.id)
	return singleArtifact(matching, `Slice ${slice.id} has multiple Slice Artifacts.`)
}

function singleArtifact<TArtifact>(artifacts: TArtifact[], message: string): Result<TArtifact | null, InvariantViolationError> {
	return artifacts.length > 1 ? { ok: false, error: { type: 'invariant-violation', message } } : { ok: true, value: artifacts[0] ?? null }
}

function agentRunReferencesDelivery(run: AgentRun, deliveryId: Delivery['id']): boolean {
	return run.purpose.type === 'execution' && run.purpose.deliveryId === deliveryId
}

function reviewSurfaceReferencesDelivery(reviewSurface: ReviewSurface, deliveryId: Delivery['id'], sliceIds: Set<Id>): boolean {
	return reviewSurface.scope.type === 'delivery'
		? reviewSurface.scope.deliveryId === deliveryId
		: sliceIds.has(reviewSurface.scope.sliceId)
}

function sliceDependencyLinks(sliceId: Id, links: Link[]): SliceDependencyLink[] {
	return links.filter((link): link is SliceDependencyLink => isContextSliceDependencyLink(link, sliceId)).sort(compareDependencyLinks)
}

function isContextSliceDependencyLink(link: Link, sliceId: Id): link is SliceDependencyLink {
	return isActiveDependsOnLink(link) && isSliceDependencyEndpointLink(link) && link.from.id === sliceId
}

function isSliceDependencyEndpointLink(link: Link): link is SliceDependencyLink {
	return link.from.type === 'slice' && link.to.type === 'slice'
}

function compareDependencyLinks(
	left: DeliveryDependencyLink | SliceDependencyLink,
	right: DeliveryDependencyLink | SliceDependencyLink,
): number {
	return left.created.at.localeCompare(right.created.at) || left.to.id.localeCompare(right.to.id)
}

function isArchived(archivePeriods: ArchivePeriod[]): boolean {
	return archivePeriods.at(-1)?.unarchived === null
}

function deliveryDependencies(
	delivery: Delivery,
	records: DeliveryContextRecords,
): Result<DeliveryDependencySummary[], DeliveryContextError> {
	const summaries: DeliveryDependencySummary[] = []
	for (const link of deliveryDependencyLinks(delivery, records.links)) {
		const summary = deliveryDependencySummary(delivery, link, records)
		if (!summary.ok) return summary
		summaries.push(summary.value)
	}

	return { ok: true, value: summaries }
}

function deliveryDependencyLinks(delivery: Delivery, links: Link[]): DeliveryDependencyLink[] {
	return links
		.filter((link): link is DeliveryDependencyLink => isContextDeliveryDependencyLink(link, delivery))
		.sort(compareDependencyLinks)
}

function isContextDeliveryDependencyLink(link: Link, delivery: Delivery): link is DeliveryDependencyLink {
	return isActiveDependsOnLink(link) && isDeliveryDependencyEndpointLink(link) && link.from.id === delivery.id
}

function isActiveDependsOnLink(link: Link): boolean {
	return link.type === 'depends-on' && !isArchived(link.archivePeriods)
}

function isDeliveryDependencyEndpointLink(link: Link): link is DeliveryDependencyLink {
	return link.from.type === 'delivery' && link.to.type === 'delivery'
}

function deliveryDependencySummary(
	delivery: Delivery,
	link: DeliveryDependencyLink,
	records: DeliveryContextRecords,
): Result<DeliveryDependencySummary, DeliveryContextError> {
	const dependency = records.deliveries.find((candidate) => candidate.id === link.to.id)
	if (dependency === undefined) return notFound('delivery', link.to.id)
	if (dependency.projectId !== delivery.projectId) {
		return {
			ok: false,
			error: {
				type: 'invariant-violation',
				message: `Delivery dependency ${dependency.id} is outside Project ${delivery.projectId}.`,
			},
		}
	}

	return { ok: true, value: { link, delivery: dependency } }
}

function firstFailure<TError>(results: ReadonlyArray<Result<unknown, TError>>): Result<never, TError> | null {
	const failure = results.find((result) => !result.ok)
	return failure === undefined || failure.ok ? null : failure
}

function resultValue<TValue>(result: Result<TValue, unknown>): TValue {
	if (!result.ok) throw new Error('Expected result value after checking for failures.')

	return result.value
}

function deliveryContext(
	root: DeliveryContextRoot,
	records: Result<ScopedDeliveryContextRecords, DeliveryContextError>,
): Result<StoredDeliveryContext, DeliveryContextError> {
	return records.ok ? { ok: true, value: { ...root, ...records.value } } : records
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { getDeliveryState, getSliceState } = await import('./work-state')
	const { resolveDeliveryWork } = await import('./work-resolution')
	const { createTestCoreServices, localStamp, seedDelivery, seedProject, seedSecret, seedSelectableModel, seedSlice } =
		await import('../test-helpers')

	describe('buildStoredDeliveryContext', () => {
		it('loads root-level Delivery facts and supports derived unqueued state', async () => {
			const options = storedContextFixture()

			const result = await buildStoredDeliveryContext(options.tx, 'delivery-1')

			expect(result).toMatchObject({ ok: true, value: { delivery: { id: 'delivery-1' } } })
			if (result.ok) {
				expect(result.value.delivery.id).toBe('delivery-1')
				expect(result.value.project.id).toBe('project-1')
				expect(result.value.repository.id).toBe('repository-1')
				expect(getDeliveryState(result.value)).toEqual({ ok: true, value: { type: 'unqueued' } })
			}
		})

		it('loads Slices in Delivery order and supports derived Slice Work States', async () => {
			const options = storedContextFixture()
			seedSlice(options.tx, 'slice-2', 'delivery-1')
			seedSlice(options.tx, 'slice-1', 'delivery-1')

			const result = await buildStoredDeliveryContext(options.tx, 'delivery-1')

			expect(result).toMatchObject({
				ok: true,
				value: {
					slices: [
						{ slice: { id: 'slice-2' }, artifact: null },
						{ slice: { id: 'slice-1' }, artifact: null },
					],
				},
			})
			if (result.ok) {
				expect(getSliceState(result.value, 'slice-2')).toEqual({ ok: true, value: { type: 'needs-artifact-creation' } })
				expect(getSliceState(result.value, 'slice-1')).toEqual({ ok: true, value: { type: 'needs-artifact-creation' } })
			}
		})

		it('loads singular Artifact facts, Slice dependency links, and sorted Actions', async () => {
			const options = storedContextFixture()
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			options.tx.deliveryArtifacts.records.set('delivery-artifact-1', {
				id: 'delivery-artifact-1',
				deliveryId: 'delivery-1',
				config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
				created: localStamp(),
			})
			options.tx.sliceArtifacts.records.set('slice-artifact-1', {
				id: 'slice-artifact-1',
				sliceId: 'slice-1',
				config: { type: 'source-control', sliceBranch: 'slice-branch' },
				created: localStamp(),
			})
			options.tx.links.records.set('link-1', {
				id: 'link-1',
				type: 'depends-on',
				from: { type: 'slice', id: 'slice-1' },
				to: { type: 'slice', id: 'slice-2' },
				created: localStamp(),
				archivePeriods: [],
			})
			options.tx.actions.records.set('action-later', {
				id: 'action-later',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T12:01:00.000Z' },
				authorized: null,
				result: { type: 'validate-preflight', checks: [] },
			})
			options.tx.actions.records.set('action-earlier', {
				id: 'action-earlier',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: { type: 'validate-preflight', checks: [] },
			})

			const result = await buildStoredDeliveryContext(options.tx, 'delivery-1')

			expect(result).toMatchObject({
				ok: true,
				value: {
					deliveryArtifact: { id: 'delivery-artifact-1' },
					slices: [
						{
							slice: { id: 'slice-1' },
							artifact: { id: 'slice-artifact-1' },
							dependencyLinks: [{ id: 'link-1' }],
						},
					],
					actions: [{ id: 'action-earlier' }, { id: 'action-later' }],
				},
			})
		})

		it('returns an invariant violation when a Delivery has multiple Artifacts', async () => {
			const options = storedContextFixture()
			options.tx.deliveryArtifacts.records.set('delivery-artifact-1', {
				id: 'delivery-artifact-1',
				deliveryId: 'delivery-1',
				config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
				created: localStamp(),
			})
			options.tx.deliveryArtifacts.records.set('delivery-artifact-2', {
				id: 'delivery-artifact-2',
				deliveryId: 'delivery-1',
				config: { type: 'source-control', deliveryBranch: 'other-delivery-branch' },
				created: localStamp(),
			})

			const result = await buildStoredDeliveryContext(options.tx, 'delivery-1')

			expect(result).toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Delivery delivery-1 has multiple Delivery Artifacts.' },
			})
		})

		it('returns an invariant violation when a Slice has multiple Artifacts', async () => {
			const options = storedContextFixture()
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			options.tx.sliceArtifacts.records.set('slice-artifact-1', {
				id: 'slice-artifact-1',
				sliceId: 'slice-1',
				config: { type: 'source-control', sliceBranch: 'slice-branch' },
				created: localStamp(),
			})
			options.tx.sliceArtifacts.records.set('slice-artifact-2', {
				id: 'slice-artifact-2',
				sliceId: 'slice-1',
				config: { type: 'source-control', sliceBranch: 'other-slice-branch' },
				created: localStamp(),
			})

			const result = await buildStoredDeliveryContext(options.tx, 'delivery-1')

			expect(result).toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Slice slice-1 has multiple Slice Artifacts.' },
			})
		})

		it('returns an invariant violation when the target Repository is outside the Delivery Project', async () => {
			const options = storedContextFixture()
			options.tx.repositories.records.get('repository-1')!.projectId = 'other-project'

			const result = await buildStoredDeliveryContext(options.tx, 'delivery-1')

			expect(result).toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Repository repository-1 is outside Project project-1.' },
			})
		})

		it('returns failed preflight checks when Delivery work needs missing Portfolio Config', async () => {
			const options = storedContextFixture()
			const stored = await buildStoredDeliveryContext(options.tx, 'delivery-1')
			if (!stored.ok) throw new Error('Expected stored context.')

			const result = await resolveDeliveryWork(options.tx, stored.value)

			expect(result).toMatchObject({
				ok: true,
				value: {
					type: 'failed',
					checks: [
						{
							type: 'validation',
							operation: { type: 'delivery-preflight' },
							passed: false,
							summary: 'Portfolio Config is not configured.',
						},
					],
				},
			})
		})

		it('resolves Delivery Work Resolution without provider access plaintext', async () => {
			const options = storedContextFixture()
			seedSelectableModel(options.tx, 'model-1')
			seedPortfolioConfig(options)
			const stored = await buildStoredDeliveryContext(options.tx, 'delivery-1')
			if (!stored.ok) throw new Error('Expected stored context.')

			const result = await resolveDeliveryWork(options.tx, stored.value)

			expect(result).toMatchObject({
				ok: true,
				value: {
					type: 'passed',
					resolution: {
						workConfig: { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30000 },
						executionModel: { id: 'model-1' },
						executionModelProvider: { id: 'model-1-provider' },
					},
				},
			})
		})
	})

	function seedPortfolioConfig(options: ReturnType<typeof storedContextFixture>) {
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
				work: { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30000 },
			},
		}
	}

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
