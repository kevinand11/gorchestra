import type { AuditStamp, Id } from '../../domain/commons'
import type { GraphNodeRef, LinkType } from '../../domain/graph'
import type { PlanOutputProposal, ProposedDelivery, ProposedGraphRef, ProposedMemory } from '../../domain/plan'
import type { Plan } from '../../domain/plan'
import type { InvalidCoreServiceOutputError, InvalidPlanOutputError } from '../../errors'
import type { OpenCoreOptions } from '../../services'
import type { Result } from '../../utils/types'
import { nextId } from '../storage-utils'
import type { ExistingRefIndex, PlanOutputMaterializationPlan, PlannedDelivery, PlannedLink, PlannedMemory, PlannedSlice } from './types'

export function prepareMaterializationPlan(
	options: OpenCoreOptions,
	plan: Plan,
	stamp: AuditStamp,
	output: PlanOutputProposal,
	existing: ExistingRefIndex,
): Result<PlanOutputMaterializationPlan, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	const basic = validateBasicOutput(output)
	if (!basic.ok) return basic

	const deliveries = plannedDeliveries(options, output.proposedDeliveries)
	if (!deliveries.ok) return deliveries

	return prepareWithDeliveries(options, plan, stamp, output, existing, deliveries.value)
}

function prepareWithDeliveries(
	options: OpenCoreOptions,
	plan: Plan,
	stamp: AuditStamp,
	output: PlanOutputProposal,
	existing: ExistingRefIndex,
	deliveries: PlannedDelivery[],
): Result<PlanOutputMaterializationPlan, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	const memories = plannedMemories(options, output.proposedMemories)
	if (!memories.ok) return memories

	return prepareWithMemories(options, plan, stamp, output, existing, deliveries, memories.value)
}

function prepareWithMemories(
	options: OpenCoreOptions,
	plan: Plan,
	stamp: AuditStamp,
	output: PlanOutputProposal,
	existing: ExistingRefIndex,
	deliveries: PlannedDelivery[],
	memories: PlannedMemory[],
): Result<PlanOutputMaterializationPlan, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	const linkPlan = plannedLinks(options, plan, output, existing, deliveries, memories)
	if (!linkPlan.ok) return linkPlan

	const materializationPlan = { plan, stamp, output, deliveries, memories, ...linkPlan.value }
	const validation = validatePlan(plan, materializationPlan, existing)
	return validation.ok ? { ok: true, value: materializationPlan } : validation
}

function validateBasicOutput(output: PlanOutputProposal): Result<void, InvalidPlanOutputError> {
	if (output.proposedDeliveries.length === 0 && output.proposedMemories.length === 0)
		return invalid({ type: 'invalid-plan-output', reason: 'empty-output' })

	return firstFailure([
		() => duplicateDeliveryKeys(output.proposedDeliveries),
		() => duplicateSliceKeys(output.proposedDeliveries),
		() => duplicateMemoryKeys(output.proposedMemories),
		() => deliveriesHaveSlices(output.proposedDeliveries),
	])
}

function plannedDeliveries(
	options: OpenCoreOptions,
	proposedDeliveries: ProposedDelivery[],
): Result<PlannedDelivery[], InvalidCoreServiceOutputError> {
	const deliveries: PlannedDelivery[] = []
	for (const proposal of proposedDeliveries) {
		const deliveryId = nextId(options, 'delivery')
		if (!deliveryId.ok) return deliveryId

		const slices = plannedSlices(options, proposal, deliveryId.value)
		if (!slices.ok) return slices
		deliveries.push({ proposal, id: deliveryId.value, slices: slices.value })
	}

	return { ok: true, value: deliveries }
}

function plannedSlices(
	options: OpenCoreOptions,
	delivery: ProposedDelivery,
	deliveryId: Id,
): Result<PlannedSlice[], InvalidCoreServiceOutputError> {
	const slices: PlannedSlice[] = []
	for (const [order, proposal] of delivery.slices.entries()) {
		const id = nextId(options, 'slice')
		if (!id.ok) return id
		slices.push({ proposal, id: id.value, deliveryKey: delivery.proposedDeliveryKey, deliveryId, order })
	}

	return { ok: true, value: slices }
}

function plannedMemories(
	options: OpenCoreOptions,
	proposedMemories: ProposedMemory[],
): Result<PlannedMemory[], InvalidCoreServiceOutputError> {
	const memories: PlannedMemory[] = []
	for (const proposal of proposedMemories) {
		const id = nextId(options, 'memory')
		if (!id.ok) return id
		memories.push({ proposal, id: id.value })
	}

	return { ok: true, value: memories }
}

function plannedLinks(
	options: OpenCoreOptions,
	plan: Plan,
	output: PlanOutputProposal,
	existing: ExistingRefIndex,
	deliveries: PlannedDelivery[],
	memories: PlannedMemory[],
): Result<
	Pick<
		PlanOutputMaterializationPlan,
		'explicitLinks' | 'deliveryDependencyLinks' | 'sliceDependencyLinks' | 'memoryLinks' | 'producedMemoryLinks'
	>,
	InvalidCoreServiceOutputError | InvalidPlanOutputError
> {
	const dependencyLinks = dependencyLinkPlan(options, deliveries)
	if (!dependencyLinks.ok) return dependencyLinks

	return plannedLinksWithDependencies(options, plan, output, existing, deliveries, memories, dependencyLinks.value)
}

function plannedLinksWithDependencies(
	options: OpenCoreOptions,
	plan: Plan,
	output: PlanOutputProposal,
	existing: ExistingRefIndex,
	deliveries: PlannedDelivery[],
	memories: PlannedMemory[],
	dependencyLinks: Pick<PlanOutputMaterializationPlan, 'deliveryDependencyLinks' | 'sliceDependencyLinks'>,
): Result<
	Pick<
		PlanOutputMaterializationPlan,
		'explicitLinks' | 'deliveryDependencyLinks' | 'sliceDependencyLinks' | 'memoryLinks' | 'producedMemoryLinks'
	>,
	InvalidCoreServiceOutputError | InvalidPlanOutputError
> {
	const memoryLinks = memoryLinkPlan(options, output, existing, deliveries, memories)
	if (!memoryLinks.ok) return memoryLinks
	const producedMemoryLinks = producedMemoryLinkPlan(options, plan, memories)
	if (!producedMemoryLinks.ok) return producedMemoryLinks

	return {
		ok: true,
		value: { explicitLinks: [], ...dependencyLinks, memoryLinks: memoryLinks.value, producedMemoryLinks: producedMemoryLinks.value },
	}
}

function dependencyLinkPlan(
	options: OpenCoreOptions,
	deliveries: PlannedDelivery[],
): Result<
	Pick<PlanOutputMaterializationPlan, 'deliveryDependencyLinks' | 'sliceDependencyLinks'>,
	InvalidCoreServiceOutputError | InvalidPlanOutputError
> {
	const deliveryDependencyLinks = deliveryDependencyLinkPlan(options, deliveries)
	if (!deliveryDependencyLinks.ok) return deliveryDependencyLinks
	const sliceDependencyLinks = sliceDependencyLinkPlan(options, deliveries)
	return sliceDependencyLinks.ok
		? { ok: true, value: { deliveryDependencyLinks: deliveryDependencyLinks.value, sliceDependencyLinks: sliceDependencyLinks.value } }
		: sliceDependencyLinks
}

function deliveryDependencyLinkPlan(
	options: OpenCoreOptions,
	deliveries: PlannedDelivery[],
): Result<PlannedLink[], InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	return collectLinks(deliveries, (delivery) => deliveryDependencyLinksForDelivery(options, delivery, deliveries))
}

function deliveryDependencyLinksForDelivery(
	options: OpenCoreOptions,
	delivery: PlannedDelivery,
	deliveries: PlannedDelivery[],
): Result<PlannedLink[], InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	const existing = collectLinks(delivery.proposal.dependsOnDeliveryIds, (dependencyId) =>
		deliveryDependencyLink(options, delivery, dependencyId),
	)
	if (!existing.ok) return existing
	const proposed = collectLinks(delivery.proposal.dependsOnProposedDeliveryKeys, (key) =>
		proposedDeliveryDependencyLink(options, delivery, key, deliveries),
	)
	return proposed.ok ? { ok: true, value: [...existing.value, ...proposed.value] } : proposed
}

function deliveryDependencyLink(
	options: OpenCoreOptions,
	delivery: PlannedDelivery,
	dependencyId: Id,
): Result<PlannedLink, InvalidCoreServiceOutputError> {
	return plannedLink(options, 'depends-on', { type: 'delivery', id: delivery.id }, { type: 'delivery', id: dependencyId })
}

function proposedDeliveryDependencyLink(
	options: OpenCoreOptions,
	delivery: PlannedDelivery,
	key: string,
	deliveries: PlannedDelivery[],
): Result<PlannedLink, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	const dependency = deliveries.find((candidate) => candidate.proposal.proposedDeliveryKey === key)
	return dependency === undefined
		? invalid({ type: 'invalid-plan-output', reason: 'unknown-proposed-delivery-key', proposedDeliveryKey: key })
		: plannedLink(options, 'depends-on', { type: 'delivery', id: delivery.id }, { type: 'delivery', id: dependency.id })
}

function sliceDependencyLinkPlan(
	options: OpenCoreOptions,
	deliveries: PlannedDelivery[],
): Result<PlannedLink[], InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	const slices = deliveries.flatMap((delivery) => delivery.slices)
	return collectLinks(slices, (slice) => sliceDependencyLinksForSlice(options, slice, slices))
}

function sliceDependencyLinksForSlice(
	options: OpenCoreOptions,
	slice: PlannedSlice,
	slices: PlannedSlice[],
): Result<PlannedLink[], InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	return collectLinks(slice.proposal.dependsOnProposedSliceKeys, (key) => proposedSliceDependencyLink(options, slice, key, slices))
}

function proposedSliceDependencyLink(
	options: OpenCoreOptions,
	slice: PlannedSlice,
	key: string,
	slices: PlannedSlice[],
): Result<PlannedLink, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	const dependency = slices.find((candidate) => candidate.proposal.proposedSliceKey === key)
	return dependency === undefined
		? invalid({ type: 'invalid-plan-output', reason: 'unknown-proposed-slice-key', proposedSliceKey: key })
		: plannedLink(options, 'depends-on', { type: 'slice', id: slice.id }, { type: 'slice', id: dependency.id })
}

function memoryLinkPlan(
	options: OpenCoreOptions,
	output: PlanOutputProposal,
	existing: ExistingRefIndex,
	deliveries: PlannedDelivery[],
	memories: PlannedMemory[],
): Result<PlannedLink[], InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	return collectLinks(memories, (memory) => memoryLinksForMemory(options, output, existing, deliveries, memories, memory))
}

function memoryLinksForMemory(
	options: OpenCoreOptions,
	output: PlanOutputProposal,
	existing: ExistingRefIndex,
	deliveries: PlannedDelivery[],
	memories: PlannedMemory[],
	memory: PlannedMemory,
): Result<PlannedLink[], InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	return collectLinks(memory.proposal.links, (link) => memoryLink(options, output, existing, deliveries, memories, memory, link))
}

function memoryLink(
	options: OpenCoreOptions,
	output: PlanOutputProposal,
	existing: ExistingRefIndex,
	deliveries: PlannedDelivery[],
	memories: PlannedMemory[],
	memory: PlannedMemory,
	link: PlannedMemory['proposal']['links'][number],
): Result<PlannedLink, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	const to = resolveProposedRef(link.to, output, existing, deliveries, memories)
	return to.ok ? plannedLink(options, link.type, { type: 'memory', id: memory.id }, to.value) : to
}

function producedMemoryLinkPlan(
	options: OpenCoreOptions,
	plan: Plan,
	memories: PlannedMemory[],
): Result<PlannedLink[], InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	return collectLinks(memories, (memory) =>
		plannedLink(options, 'produced', { type: 'plan', id: plan.id }, { type: 'memory', id: memory.id }),
	)
}

function collectLinks<TItem>(
	items: TItem[],
	linkFor: (item: TItem) => Result<PlannedLink | PlannedLink[], InvalidCoreServiceOutputError | InvalidPlanOutputError>,
): Result<PlannedLink[], InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	const links: PlannedLink[] = []
	for (const item of items) {
		const link = linkFor(item)
		if (!link.ok) return link
		links.push(...(Array.isArray(link.value) ? link.value : [link.value]))
	}

	return { ok: true, value: links }
}

function plannedLink(
	options: OpenCoreOptions,
	type: PlannedLink['type'],
	from: PlannedLink['from'],
	to: PlannedLink['to'],
): Result<PlannedLink, InvalidCoreServiceOutputError> {
	const id = nextId(options, 'link')
	return id.ok ? { ok: true, value: { id: id.value, type, from, to } } : id
}

function validatePlan(
	plan: Plan,
	materializationPlan: PlanOutputMaterializationPlan,
	existing: ExistingRefIndex,
): Result<PlanOutputMaterializationPlan, InvalidPlanOutputError> {
	const validation = firstFailure([
		() => validateRepositoryTargets(plan, materializationPlan, existing),
		() => validateDependencyRefs(materializationPlan, existing),
		() => validateLinkBoundaries(plan, materializationPlan, existing),
		() => validateDuplicateLinks(materializationPlan),
		() => validateDeliveryCycles(materializationPlan, existing),
		() => validateSliceCycles(materializationPlan),
	])

	return validation.ok ? { ok: true, value: materializationPlan } : validation
}

function validateRepositoryTargets(
	plan: Plan,
	materializationPlan: PlanOutputMaterializationPlan,
	existing: ExistingRefIndex,
): Result<void, InvalidPlanOutputError> {
	for (const delivery of materializationPlan.deliveries) {
		const repository = existing.repositories.find((candidate) => candidate.id === delivery.proposal.target.repositoryId)
		if (repository === undefined)
			return invalid({ type: 'invalid-plan-output', reason: 'unknown-existing-ref', ref: { type: 'delivery', id: delivery.id } })
		if (repository.projectId !== plan.projectId)
			return invalid({
				type: 'invalid-plan-output',
				reason: 'repository-project-mismatch',
				proposedDeliveryKey: delivery.proposal.proposedDeliveryKey,
				repositoryId: repository.id,
			})
	}

	return okVoid()
}

function validateDependencyRefs(plan: PlanOutputMaterializationPlan, existing: ExistingRefIndex): Result<void, InvalidPlanOutputError> {
	const deliveryValidation = validateDeliveryDependencyRefs(plan, existing)
	return deliveryValidation.ok ? validateSliceDependencyRefs(plan) : deliveryValidation
}

function validateDeliveryDependencyRefs(
	plan: PlanOutputMaterializationPlan,
	existing: ExistingRefIndex,
): Result<void, InvalidPlanOutputError> {
	const deliveryIds = new Set([...existing.deliveries.map((delivery) => delivery.id), ...plan.deliveries.map((delivery) => delivery.id)])
	return validateDependencyLinkRefs(
		plan.deliveryDependencyLinks,
		(link) => deliveryIds.has(link.from.id) && deliveryIds.has(link.to.id),
		(link) => unknownDeliveryDependency(plan, link),
	)
}

function validateSliceDependencyRefs(plan: PlanOutputMaterializationPlan): Result<void, InvalidPlanOutputError> {
	const sliceIds = new Set(plan.deliveries.flatMap((delivery) => delivery.slices.map((slice) => slice.id)))
	return validateDependencyLinkRefs(
		plan.sliceDependencyLinks,
		(link) => sliceIds.has(link.from.id) && sliceIds.has(link.to.id),
		(link) => unknownSliceDependency(plan, link),
	)
}

function validateDependencyLinkRefs(
	links: PlannedLink[],
	exists: (link: PlannedLink) => boolean,
	unknown: (link: PlannedLink) => Result<never, InvalidPlanOutputError>,
): Result<void, InvalidPlanOutputError> {
	for (const link of links) {
		if (link.from.id === link.to.id)
			return invalid({ type: 'invalid-plan-output', reason: 'invalid-depends-on-scope', from: link.from, to: link.to })
		if (!exists(link)) return unknown(link)
	}

	return okVoid()
}

function validateLinkBoundaries(
	plan: Plan,
	materializationPlan: PlanOutputMaterializationPlan,
	existing: ExistingRefIndex,
): Result<void, InvalidPlanOutputError> {
	return firstFailure(allLinks(materializationPlan).map((link) => () => validateLinkBoundary(plan, materializationPlan, existing, link)))
}

function validateLinkBoundary(
	plan: Plan,
	materializationPlan: PlanOutputMaterializationPlan,
	existing: ExistingRefIndex,
	link: PlannedLink,
): Result<void, InvalidPlanOutputError> {
	const dependencyScope = validateDependsOnScope(link, materializationPlan)
	return dependencyScope.ok ? validateProjectBoundary(plan, link, existing, materializationPlan) : dependencyScope
}

function validateDependsOnScope(
	link: PlannedLink,
	materializationPlan: PlanOutputMaterializationPlan,
): Result<void, InvalidPlanOutputError> {
	return link.type !== 'depends-on' || validDependsOn(link, materializationPlan)
		? okVoid()
		: invalid({ type: 'invalid-plan-output', reason: 'invalid-depends-on-scope', from: link.from, to: link.to })
}

function validDependsOn(link: PlannedLink, materializationPlan: PlanOutputMaterializationPlan): boolean {
	return deliveryDependsOnDelivery(link) || sliceDependsOnSameDeliverySlice(link, materializationPlan)
}

function deliveryDependsOnDelivery(link: PlannedLink): boolean {
	return link.from.type === 'delivery' && link.to.type === 'delivery'
}

function sliceDependsOnSameDeliverySlice(link: PlannedLink, materializationPlan: PlanOutputMaterializationPlan): boolean {
	return link.from.type === 'slice' && link.to.type === 'slice' && sameMaterializedDelivery(link.from.id, link.to.id, materializationPlan)
}

function sameMaterializedDelivery(leftId: Id, rightId: Id, materializationPlan: PlanOutputMaterializationPlan): boolean {
	const slices = materializationPlan.deliveries.flatMap((delivery) => delivery.slices)
	return slices.find((slice) => slice.id === leftId)?.deliveryId === slices.find((slice) => slice.id === rightId)?.deliveryId
}

function validateProjectBoundary(
	plan: Plan,
	link: PlannedLink,
	existing: ExistingRefIndex,
	materializationPlan: PlanOutputMaterializationPlan,
): Result<void, InvalidPlanOutputError> {
	const boundary = linkProjectBoundary(plan, link, existing, materializationPlan)
	return boundary.type === 'valid'
		? okVoid()
		: invalid({ type: 'invalid-plan-output', reason: 'project-boundary-mismatch', ref: boundary.ref })
}

function linkProjectBoundary(
	plan: Plan,
	link: PlannedLink,
	existing: ExistingRefIndex,
	materializationPlan: PlanOutputMaterializationPlan,
): { type: 'valid' } | { type: 'invalid'; ref: GraphNodeRef } {
	const boundary = {
		from: refProject(link.from, plan, existing, materializationPlan),
		to: refProject(link.to, plan, existing, materializationPlan),
	}
	return isValidProjectBoundary(plan, boundary) ? { type: 'valid' } : { type: 'invalid', ref: invalidBoundaryRef(plan, link, boundary) }
}

function isValidProjectBoundary(plan: Plan, boundary: { from: Id | 'memory' | null; to: Id | 'memory' | null }): boolean {
	return boundary.from === 'memory' || boundary.to === 'memory' || (boundary.from === plan.projectId && boundary.to === plan.projectId)
}

function invalidBoundaryRef(
	plan: Plan,
	link: PlannedLink,
	boundary: { from: Id | 'memory' | null; to: Id | 'memory' | null },
): GraphNodeRef {
	return boundary.from === plan.projectId ? link.to : link.from
}

function refProject(
	ref: GraphNodeRef,
	plan: Plan,
	existing: ExistingRefIndex,
	materializationPlan: PlanOutputMaterializationPlan,
): Id | 'memory' | null {
	const resolvers = {
		memory: () => 'memory' as const,
		project: () => ref.id,
		plan: () => planRefProject(ref.id, plan, existing),
		delivery: () => deliveryRefProject(ref.id, plan, existing, materializationPlan),
		slice: () => sliceProject(ref.id, plan, existing, materializationPlan),
	}

	return resolvers[ref.type]()
}

function planRefProject(planId: Id, plan: Plan, existing: ExistingRefIndex): Id | null {
	return planId === plan.id ? plan.projectId : (existing.plans.find((candidate) => candidate.id === planId)?.projectId ?? null)
}

function deliveryRefProject(
	deliveryId: Id,
	plan: Plan,
	existing: ExistingRefIndex,
	materializationPlan: PlanOutputMaterializationPlan,
): Id | null {
	return materializationPlan.deliveries.some((delivery) => delivery.id === deliveryId)
		? plan.projectId
		: (existing.deliveries.find((delivery) => delivery.id === deliveryId)?.projectId ?? null)
}

function sliceProject(sliceId: Id, plan: Plan, existing: ExistingRefIndex, materializationPlan: PlanOutputMaterializationPlan): Id | null {
	const planned = materializedSlice(sliceId, materializationPlan)
	return planned === null ? existingSliceProject(sliceId, existing) : plan.projectId
}

function materializedSlice(sliceId: Id, materializationPlan: PlanOutputMaterializationPlan): PlannedSlice | null {
	return materializationPlan.deliveries.flatMap((delivery) => delivery.slices).find((slice) => slice.id === sliceId) ?? null
}

function existingSliceProject(sliceId: Id, existing: ExistingRefIndex): Id | null {
	const slice = existing.slices.find((candidate) => candidate.id === sliceId)
	return slice === undefined ? null : (existing.deliveries.find((delivery) => delivery.id === slice.deliveryId)?.projectId ?? null)
}

function validateDuplicateLinks(plan: PlanOutputMaterializationPlan): Result<void, InvalidPlanOutputError> {
	const seen = new Set<string>()
	for (const link of allLinks(plan)) {
		const key = linkKey(link)
		if (seen.has(key))
			return invalid({ type: 'invalid-plan-output', reason: 'duplicate-link', linkType: link.type, from: link.from, to: link.to })
		seen.add(key)
	}

	return okVoid()
}

function validateDeliveryCycles(plan: PlanOutputMaterializationPlan, existing: ExistingRefIndex): Result<void, InvalidPlanOutputError> {
	return hasCycle(deliveryDependencyEdges(plan, existing))
		? invalid({ type: 'invalid-plan-output', reason: 'delivery-dependency-cycle' })
		: okVoid()
}

function validateSliceCycles(plan: PlanOutputMaterializationPlan): Result<void, InvalidPlanOutputError> {
	for (const delivery of plan.deliveries) {
		if (
			hasCycle(
				plan.sliceDependencyLinks
					.filter((link) => delivery.slices.some((slice) => slice.id === link.from.id))
					.map((link) => [link.from.id, link.to.id]),
			)
		) {
			return invalid({
				type: 'invalid-plan-output',
				reason: 'slice-dependency-cycle',
				proposedDeliveryKey: delivery.proposal.proposedDeliveryKey,
			})
		}
	}

	return okVoid()
}

function deliveryDependencyEdges(plan: PlanOutputMaterializationPlan, existing: ExistingRefIndex): Array<[Id, Id]> {
	const existingDeliveryIds = new Set(existing.deliveries.map((delivery) => delivery.id))
	const existingEdges = existing.links
		.filter(
			(link) =>
				link.type === 'depends-on' &&
				link.from.type === 'delivery' &&
				link.to.type === 'delivery' &&
				link.archivePeriods.length === 0,
		)
		.filter((link) => existingDeliveryIds.has(link.from.id) && existingDeliveryIds.has(link.to.id))
		.map((link) => [link.from.id, link.to.id] as [Id, Id])

	return [...existingEdges, ...plan.deliveryDependencyLinks.map((link) => [link.from.id, link.to.id] as [Id, Id])]
}

function hasCycle(edges: Array<[Id, Id]>): boolean {
	const graph = new Map<Id, Id[]>()
	for (const [from, to] of edges) graph.set(from, [...(graph.get(from) ?? []), to])

	return [...graph.keys()].some((node) => visitsCycle(node, graph, new Set(), new Set()))
}

function visitsCycle(node: Id, graph: Map<Id, Id[]>, visiting: Set<Id>, visited: Set<Id>): boolean {
	if (visited.has(node)) return false
	if (visiting.has(node)) return true
	visiting.add(node)
	const cyclic = (graph.get(node) ?? []).some((next) => visitsCycle(next, graph, visiting, visited))
	visiting.delete(node)
	visited.add(node)

	return cyclic
}

function resolveProposedRef(
	ref: ProposedGraphRef,
	output: PlanOutputProposal,
	existing: ExistingRefIndex,
	deliveries: PlannedDelivery[],
	memories: PlannedMemory[],
): Result<GraphNodeRef, InvalidPlanOutputError> {
	if (ref.type === 'existing') return existingRef(ref.node, existing)
	if (ref.type === 'proposed-delivery') return proposedDeliveryRef(ref.proposedDeliveryKey, deliveries)
	if (ref.type === 'proposed-slice') return proposedSliceRef(ref.proposedSliceKey, deliveries)
	return proposedMemoryRef(ref.proposedMemoryKey, output, memories)
}

function existingRef(ref: GraphNodeRef, existing: ExistingRefIndex): Result<GraphNodeRef, InvalidPlanOutputError> {
	const exists = ref.type === 'project' || existingRecordExists(ref, existing)
	return exists ? ok(ref) : invalid({ type: 'invalid-plan-output', reason: 'unknown-existing-ref', ref })
}

function existingRecordExists(ref: GraphNodeRef, existing: ExistingRefIndex): boolean {
	const recordSets = {
		plan: existing.plans,
		delivery: existing.deliveries,
		slice: existing.slices,
		memory: existing.memories,
		project: [{ id: ref.id }],
	}

	return recordSets[ref.type].some((record) => record.id === ref.id)
}

function proposedDeliveryRef(key: string, deliveries: PlannedDelivery[]): Result<GraphNodeRef, InvalidPlanOutputError> {
	const delivery = deliveries.find((candidate) => candidate.proposal.proposedDeliveryKey === key)
	return delivery === undefined
		? invalid({ type: 'invalid-plan-output', reason: 'unknown-proposed-delivery-key', proposedDeliveryKey: key })
		: ok({ type: 'delivery', id: delivery.id })
}

function proposedSliceRef(key: string, deliveries: PlannedDelivery[]): Result<GraphNodeRef, InvalidPlanOutputError> {
	const slice = deliveries.flatMap((delivery) => delivery.slices).find((candidate) => candidate.proposal.proposedSliceKey === key)
	return slice === undefined
		? invalid({ type: 'invalid-plan-output', reason: 'unknown-proposed-slice-key', proposedSliceKey: key })
		: ok({ type: 'slice', id: slice.id })
}

function proposedMemoryRef(
	key: string,
	output: PlanOutputProposal,
	memories: PlannedMemory[],
): Result<GraphNodeRef, InvalidPlanOutputError> {
	const memory = memories.find((candidate) => candidate.proposal.proposedMemoryKey === key)
	return output.proposedMemories.some((candidate) => candidate.proposedMemoryKey === key) && memory !== undefined
		? ok({ type: 'memory', id: memory.id })
		: invalid({ type: 'invalid-plan-output', reason: 'unknown-proposed-memory-key', proposedMemoryKey: key })
}

function unknownDeliveryDependency(plan: PlanOutputMaterializationPlan, link: PlannedLink): Result<never, InvalidPlanOutputError> {
	const delivery = plan.deliveries.find((candidate) => candidate.id === link.from.id)
	const key = delivery?.proposal.dependsOnProposedDeliveryKeys.find((candidate) => candidate === link.to.id)
	return key === undefined
		? invalid({ type: 'invalid-plan-output', reason: 'unknown-existing-ref', ref: link.to })
		: invalid({ type: 'invalid-plan-output', reason: 'unknown-proposed-delivery-key', proposedDeliveryKey: key })
}

function unknownSliceDependency(plan: PlanOutputMaterializationPlan, link: PlannedLink): Result<never, InvalidPlanOutputError> {
	const slice = plan.deliveries.flatMap((delivery) => delivery.slices).find((candidate) => candidate.id === link.from.id)
	const key = slice?.proposal.dependsOnProposedSliceKeys.find((candidate) => candidate === link.to.id)
	return invalid({ type: 'invalid-plan-output', reason: 'unknown-proposed-slice-key', proposedSliceKey: key ?? String(link.to.id) })
}

function duplicateDeliveryKeys(deliveries: ProposedDelivery[]): Result<void, InvalidPlanOutputError> {
	const duplicate = firstDuplicate(deliveries.map((delivery) => delivery.proposedDeliveryKey))
	return duplicate === null
		? okVoid()
		: invalid({ type: 'invalid-plan-output', reason: 'duplicate-proposed-delivery-key', proposedDeliveryKey: duplicate })
}

function duplicateSliceKeys(deliveries: ProposedDelivery[]): Result<void, InvalidPlanOutputError> {
	const duplicate = firstDuplicate(deliveries.flatMap((delivery) => delivery.slices.map((slice) => slice.proposedSliceKey)))
	return duplicate === null
		? okVoid()
		: invalid({ type: 'invalid-plan-output', reason: 'duplicate-proposed-slice-key', proposedSliceKey: duplicate })
}

function duplicateMemoryKeys(memories: ProposedMemory[]): Result<void, InvalidPlanOutputError> {
	const duplicate = firstDuplicate(memories.map((memory) => memory.proposedMemoryKey))
	return duplicate === null
		? okVoid()
		: invalid({ type: 'invalid-plan-output', reason: 'duplicate-proposed-memory-key', proposedMemoryKey: duplicate })
}

function deliveriesHaveSlices(deliveries: ProposedDelivery[]): Result<void, InvalidPlanOutputError> {
	const empty = deliveries.find((delivery) => delivery.slices.length === 0)
	return empty === undefined
		? okVoid()
		: invalid({ type: 'invalid-plan-output', reason: 'delivery-without-slices', proposedDeliveryKey: empty.proposedDeliveryKey })
}

function firstDuplicate(values: string[]): string | null {
	const seen = new Set<string>()
	return values.find((value) => (seen.has(value) ? true : (seen.add(value), false))) ?? null
}

function allLinks(plan: PlanOutputMaterializationPlan): PlannedLink[] {
	return [
		...plan.explicitLinks,
		...plan.deliveryDependencyLinks,
		...plan.sliceDependencyLinks,
		...plan.memoryLinks,
		...plan.producedMemoryLinks,
	]
}

function linkKey(link: { type: LinkType; from: GraphNodeRef; to: GraphNodeRef }): string {
	return `${link.type}:${link.from.type}:${link.from.id}->${link.to.type}:${link.to.id}`
}

function firstFailure(checks: Array<() => Result<void, InvalidPlanOutputError>>): Result<void, InvalidPlanOutputError> {
	for (const check of checks) {
		const result = check()
		if (!result.ok) return result
	}

	return okVoid()
}

function invalid(error: InvalidPlanOutputError): Result<never, InvalidPlanOutputError> {
	return { ok: false, error }
}

function okVoid(): Result<void, never> {
	return { ok: true, value: undefined }
}

function ok<T>(value: T): Result<T, never> {
	return { ok: true, value }
}
