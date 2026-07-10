import type { DeliveryContext, DeliveryContextSlice, DeliveryDependencySummary } from './types'
import { compareActions } from './work-state/actions'
import type { DeliveryDependencyLink, SliceDependencyLink, WorkStateDerivationError } from './work-state/types'
import type { Action } from '../../domain/action'
import type { AgentRun } from '../../domain/agent-run'
import type { Id } from '../../domain/commons'
import type { Delivery } from '../../domain/delivery'
import type { DeliveryArtifact } from '../../domain/delivery-artifact'
import type { Link } from '../../domain/link'
import type { Project } from '../../domain/project'
import type { Repository } from '../../domain/repository'
import type { ReviewSurface } from '../../domain/review-surface'
import type { Slice } from '../../domain/slice'
import type { SliceArtifact } from '../../domain/slice-artifact'
import type { InvariantViolationError } from '../../errors'
import type { CoreStorage } from '../../services'
import { getRequired, listRecords, notFound } from '../storage/helpers'
import type { Result } from '../types'

export type DeliveryContextError = WorkStateDerivationError

export async function buildDeliveryContext(
	storage: CoreStorage,
	deliveryId: Delivery['id'],
): Promise<Result<DeliveryContext, DeliveryContextError>> {
	const root = await readDeliveryContextRoot(storage, deliveryId)
	if (!root.ok) return root

	const records = await readDeliveryContextRecords(storage, root.value.delivery)
	if (!records.ok) return records

	return deliveryContext(root.value, scopedDeliveryContextRecords(root.value.delivery, records.value))
}

interface DeliveryContextRoot {
	delivery: Delivery
	project: Project
	repository: Repository
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
	slices: DeliveryContextSlice[]
	actions: Action[]
	agentRuns: AgentRun[]
	reviewSurfaces: ReviewSurface[]
	deliveryDependencies: DeliveryDependencySummary[]
}

async function readDeliveryContextRoot(
	storage: CoreStorage,
	deliveryId: Delivery['id'],
): Promise<Result<DeliveryContextRoot, DeliveryContextError>> {
	const delivery = await getRequired('delivery', storage, deliveryId)
	return delivery.ok ? readDeliveryContextRootForDelivery(storage, delivery.value) : delivery
}

async function readDeliveryContextRootForDelivery(
	storage: CoreStorage,
	delivery: Delivery,
): Promise<Result<DeliveryContextRoot, DeliveryContextError>> {
	const [project, repository] = await Promise.all([
		getRequired('project', storage, delivery.projectId),
		getRequired('repository', storage, delivery.target.repositoryId),
	])
	const failure = firstFailure([project, repository])
	if (failure !== null) return failure

	const projectRecord = resultValue(project)
	const repositoryRecord = resultValue(repository)
	const projectBoundary = repositoryProjectBoundary(projectRecord, repositoryRecord)
	return projectBoundary.ok ? { ok: true, value: deliveryContextRoot(delivery, projectRecord, repositoryRecord) } : projectBoundary
}

function deliveryContextRoot(delivery: Delivery, project: Project, repository: Repository): DeliveryContextRoot {
	return { delivery, project, repository }
}

function repositoryProjectBoundary(project: Project, repository: Repository): Result<void, InvariantViolationError> {
	return repository.projectId === project.id
		? { ok: true, value: undefined }
		: {
				ok: false,
				error: { type: 'invariant-violation', message: `Repository ${repository.id} is outside Project ${project.id}.` },
			}
}

async function readDeliveryContextRecords(
	storage: CoreStorage,
	delivery: Delivery,
): Promise<Result<DeliveryContextRecords, DeliveryContextError>> {
	const slices = await listRecords('slice', storage, {
		where: (filter, fields) => filter.eq(fields.deliveryId, delivery.id),
	})
	if (!slices.ok) return slices

	const links = await listRecords('link', storage, {
		where: (filter, fields) => {
			const def = fields.def
			const from = def.nested('from', 'object')
			return filter
				.eq(def.nested('type', 'string'), 'depends-on')
				.or([
					(group) => group.eq(from.nested('type', 'string'), 'delivery').eq(from.nested('id', 'string'), delivery.id),
					(group) => group.eq(from.nested('type', 'string'), 'slice').eq(from.nested('deliveryId', 'string'), delivery.id),
				])
		},
	})
	if (!links.ok) return links

	const [actions, agentRuns, deliveries, deliveryArtifacts, sliceArtifacts, reviewSurfaces] = await Promise.all([
		listRecords('action', storage, { where: (filter, fields) => filter.eq(fields.deliveryId, delivery.id) }),
		listRecords('agent-run', storage),
		listDependencyDeliveries(storage, delivery, links.value),
		listRecords('delivery-artifact', storage, { where: (filter, fields) => filter.eq(fields.deliveryId, delivery.id) }),
		listSliceArtifacts(storage, slices.value),
		listRecords('review-surface', storage),
	] as const)
	const failure = firstFailure([actions, agentRuns, deliveries, deliveryArtifacts, sliceArtifacts, reviewSurfaces])
	if (failure !== null) return failure

	return {
		ok: true,
		value: {
			slices: slices.value,
			links: links.value,
			actions: resultValue(actions).sort(compareActions),
			agentRuns: resultValue(agentRuns),
			deliveries: resultValue(deliveries),
			deliveryArtifacts: resultValue(deliveryArtifacts),
			sliceArtifacts: resultValue(sliceArtifacts),
			reviewSurfaces: resultValue(reviewSurfaces),
		},
	}
}

function listDependencyDeliveries(
	storage: CoreStorage,
	delivery: Delivery,
	links: Link[],
): Promise<Result<Delivery[], DeliveryContextError>> {
	const dependencyIds = uniqueIds(deliveryDependencyLinks(delivery, links).map((link) => link.def.to.id))
	return dependencyIds.length === 0
		? Promise.resolve(successful<Delivery[]>([]))
		: listRecords('delivery', storage, { where: (filter, fields) => filter.in(fields.id, dependencyIds) })
}

function listSliceArtifacts(storage: CoreStorage, slices: Slice[]): Promise<Result<SliceArtifact[], DeliveryContextError>> {
	const sliceIds = slices.map((slice) => slice.id)
	return sliceIds.length === 0
		? Promise.resolve(successful<SliceArtifact[]>([]))
		: listRecords('slice-artifact', storage, { where: (filter, fields) => filter.in(fields.sliceId, sliceIds) })
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
	const slices = deliveryContextSlices(orderedSlices, records)
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

function deliveryContextSlices(slices: Slice[], records: DeliveryContextRecords): Result<DeliveryContextSlice[], DeliveryContextError> {
	const stored: DeliveryContextSlice[] = []
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
	return link.def.type === 'depends-on' && isSliceDependencyEndpointLink(link) && link.def.from.id === sliceId
}

function isSliceDependencyEndpointLink(link: Link): link is SliceDependencyLink {
	return link.def.from.type === 'slice' && link.def.to.type === 'slice'
}

function compareDependencyLinks(
	left: DeliveryDependencyLink | SliceDependencyLink,
	right: DeliveryDependencyLink | SliceDependencyLink,
): number {
	return left.created.at.localeCompare(right.created.at) || left.def.to.id.localeCompare(right.def.to.id)
}

function deliveryDependencies(
	delivery: Delivery,
	records: DeliveryContextRecords,
): Result<DeliveryDependencySummary[], DeliveryContextError> {
	const summaries: DeliveryDependencySummary[] = []
	for (const link of deliveryDependencyLinks(delivery, records.links)) {
		const summary = deliveryDependencySummary(link, records)
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
	return (
		link.def.type === 'depends-on' &&
		isDeliveryDependencyEndpointLink(link) &&
		link.def.from.id === delivery.id &&
		link.def.from.projectId === delivery.projectId
	)
}

function isDeliveryDependencyEndpointLink(link: Link): link is DeliveryDependencyLink {
	return link.def.from.type === 'delivery' && link.def.to.type === 'delivery'
}

function deliveryDependencySummary(
	link: DeliveryDependencyLink,
	records: DeliveryContextRecords,
): Result<DeliveryDependencySummary, DeliveryContextError> {
	const dependency = records.deliveries.find((candidate) => candidate.id === link.def.to.id)
	if (dependency === undefined) return notFound('delivery', link.def.to.id)
	if (dependency.projectId !== link.def.to.projectId) {
		return {
			ok: false,
			error: {
				type: 'invariant-violation',
				message: `Delivery dependency ${dependency.id} does not match Link target Project ${link.def.to.projectId}.`,
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

function successful<TValue>(value: TValue): Result<TValue, never> {
	return { ok: true, value }
}

function uniqueIds(ids: Id[]): Id[] {
	return [...new Set(ids)]
}

function deliveryContext(
	root: DeliveryContextRoot,
	records: Result<ScopedDeliveryContextRecords, DeliveryContextError>,
): Result<DeliveryContext, DeliveryContextError> {
	return records.ok ? { ok: true, value: { ...root, ...records.value } } : records
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { getDeliveryState, getSliceState } = await import('./work-state')
	const { resolveDeliveryWork } = await import('./work-resolution')
	const { createTestCoreServices, localStamp, seedAgentRunProfile, seedDelivery, seedProject, seedSecret, seedSlice } =
		await import('../test-helpers')

	describe('buildDeliveryContext', () => {
		it('loads root-level Delivery facts and supports derived unqueued state', async () => {
			const options = storedContextFixture()

			const result = await buildDeliveryContext(options.tx, '01k00000000000000000000008')

			expect(result).toMatchObject({ ok: true, value: { delivery: { id: '01k00000000000000000000008' } } })
			if (result.ok) {
				expect(result.value.delivery.id).toBe('01k00000000000000000000008')
				expect(result.value.project.id).toBe('01k00000000000000000000030')
				expect(result.value.repository.id).toBe('01k00000000000000000000034')
				expect(getDeliveryState(result.value)).toEqual({ ok: true, value: { type: 'unqueued' } })
			}
		})

		it('loads Slices in Delivery order and supports derived Slice Work States', async () => {
			const options = storedContextFixture()
			seedSlice(options.tx, '01k00000000000000000000043', '01k00000000000000000000008')
			seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')

			const result = await buildDeliveryContext(options.tx, '01k00000000000000000000008')

			expect(result).toMatchObject({
				ok: true,
				value: {
					slices: [
						{ slice: { id: '01k00000000000000000000043' }, artifact: null },
						{ slice: { id: '01k00000000000000000000042' }, artifact: null },
					],
				},
			})
			if (result.ok) {
				expect(getSliceState(result.value, '01k00000000000000000000043')).toEqual({
					ok: true,
					value: { type: 'needs-artifact-creation' },
				})
				expect(getSliceState(result.value, '01k00000000000000000000042')).toEqual({
					ok: true,
					value: { type: 'needs-artifact-creation' },
				})
			}
		})

		it('loads singular Artifact facts, Slice dependency links, and sorted Actions', async () => {
			const options = storedContextFixture()
			seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')
			options.tx.deliveryArtifacts.records.set('01k00000000000000000000010', {
				id: '01k00000000000000000000010',
				deliveryId: '01k00000000000000000000008',
				config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
				created: localStamp(),
			})
			options.tx.sliceArtifacts.records.set('01k00000000000000000000045', {
				id: '01k00000000000000000000045',
				sliceId: '01k00000000000000000000042',
				config: { type: 'source-control', sliceBranch: 'slice-branch' },
				created: localStamp(),
			})
			options.tx.links.records.set('01k00000000000000000000014', {
				id: '01k00000000000000000000014',
				def: {
					type: 'depends-on',
					from: {
						type: 'slice',
						projectId: '01k00000000000000000000030',
						deliveryId: '01k00000000000000000000008',
						id: '01k00000000000000000000042',
					},
					to: {
						type: 'slice',
						projectId: '01k00000000000000000000030',
						deliveryId: '01k00000000000000000000008',
						id: '01k00000000000000000000043',
					},
				},
				created: localStamp(),
			})
			options.tx.actions.records.set('01k00000000000000000100057', {
				id: '01k00000000000000000100057',
				deliveryId: '01k00000000000000000000008',
				performed: { at: '2026-06-10T12:01:00.000Z' },
				authorized: null,
				result: { type: 'validate-preflight', checks: [] },
			})
			options.tx.actions.records.set('01k00000000000000000100056', {
				id: '01k00000000000000000100056',
				deliveryId: '01k00000000000000000000008',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: { type: 'validate-preflight', checks: [] },
			})

			const result = await buildDeliveryContext(options.tx, '01k00000000000000000000008')

			expect(result).toMatchObject({
				ok: true,
				value: {
					deliveryArtifact: { id: '01k00000000000000000000010' },
					slices: [
						{
							slice: { id: '01k00000000000000000000042' },
							artifact: { id: '01k00000000000000000000045' },
							dependencyLinks: [{ id: '01k00000000000000000000014' }],
						},
					],
					actions: [{ id: '01k00000000000000000100056' }, { id: '01k00000000000000000100057' }],
				},
			})
		})

		it('returns an invariant violation when a Delivery has multiple Artifacts', async () => {
			const options = storedContextFixture()
			options.tx.deliveryArtifacts.records.set('01k00000000000000000000010', {
				id: '01k00000000000000000000010',
				deliveryId: '01k00000000000000000000008',
				config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
				created: localStamp(),
			})
			options.tx.deliveryArtifacts.records.set('01k00000000000000000000011', {
				id: '01k00000000000000000000011',
				deliveryId: '01k00000000000000000000008',
				config: { type: 'source-control', deliveryBranch: 'other-delivery-branch' },
				created: localStamp(),
			})

			const result = await buildDeliveryContext(options.tx, '01k00000000000000000000008')

			expect(result).toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Delivery 01k00000000000000000000008 has multiple Delivery Artifacts.' },
			})
		})

		it('returns an invariant violation when a Slice has multiple Artifacts', async () => {
			const options = storedContextFixture()
			seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')
			options.tx.sliceArtifacts.records.set('01k00000000000000000000045', {
				id: '01k00000000000000000000045',
				sliceId: '01k00000000000000000000042',
				config: { type: 'source-control', sliceBranch: 'slice-branch' },
				created: localStamp(),
			})
			options.tx.sliceArtifacts.records.set('01k00000000000000000000046', {
				id: '01k00000000000000000000046',
				sliceId: '01k00000000000000000000042',
				config: { type: 'source-control', sliceBranch: 'other-slice-branch' },
				created: localStamp(),
			})

			const result = await buildDeliveryContext(options.tx, '01k00000000000000000000008')

			expect(result).toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Slice 01k00000000000000000000042 has multiple Slice Artifacts.' },
			})
		})

		it('returns an invariant violation when the target Repository is outside the Delivery Project', async () => {
			const options = storedContextFixture()
			options.tx.repositories.records.get('01k00000000000000000000034')!.projectId = '01k00000000000000000010020'

			const result = await buildDeliveryContext(options.tx, '01k00000000000000000000008')

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'invariant-violation',
					message: 'Repository 01k00000000000000000000034 is outside Project 01k00000000000000000000030.',
				},
			})
		})

		it('returns an operation error when Delivery work references a missing Agent Run Profile', async () => {
			const options = storedContextFixture()
			const stored = await buildDeliveryContext(options.tx, '01k00000000000000000000008')
			if (!stored.ok) throw new Error('Expected Delivery Context.')

			const result = await resolveDeliveryWork(options.tx, stored.value)

			expect(result).toEqual({
				ok: false,
				error: { type: 'not-found', resource: 'agent-run-profile', id: '01k00000000000000000000006' },
			})
		})

		it('resolves Delivery Work Resolution without provider access plaintext', async () => {
			const options = storedContextFixture()
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
			const stored = await buildDeliveryContext(options.tx, '01k00000000000000000000008')
			if (!stored.ok) throw new Error('Expected Delivery Context.')

			const result = await resolveDeliveryWork(options.tx, stored.value)

			expect(result).toMatchObject({
				ok: true,
				value: {
					type: 'passed',
					resolution: {
						workConfig: {
							maxProcessableSliceSlots: 1,
							maxCorrectionRetriesPerFailure: 1,
							executionAgentRunProfileId: '01k00000000000000000000006',
							revisionExecutionAgentRunProfileId: null,
						},
						executionProfile: { id: '01k00000000000000000000006' },
						executionModel: { id: '01k00000000000000000000024' },
						executionModelProvider: { id: '01k00000000000000000050024' },
					},
				},
			})
		})
	})

	function storedContextFixture() {
		const options = createTestCoreServices()
		seedProject(options.tx, '01k00000000000000000000030')
		seedDelivery(options.tx, '01k00000000000000000000008')
		seedSecret(options.tx, '01k00000000000000000000040')
		options.tx.repositories.records.set('01k00000000000000000000034', {
			id: '01k00000000000000000000034',
			projectId: '01k00000000000000000000030',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: '01k00000000000000000000040' },
			created: localStamp(),
		})
		return options
	}
}
