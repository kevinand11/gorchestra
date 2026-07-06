import { v, type Pipe, type PipeOutput } from 'valleyed'

import { freeFormStringPipe, idPipe, nonEmptyTrimmedStringPipe, nonNegativeIntegerPipe } from './commons'

const proposedKeyPipe = nonEmptyTrimmedStringPipe
const dependencySetPipe = v.record(proposedKeyPipe, v.eq(true))
const existingIdSetPipe = v.record(idPipe, v.eq(true))

export const instructionSourcePipe = v.object({ body: freeFormStringPipe })
export type InstructionSource = PipeOutput<typeof instructionSourcePipe>

export const proposedDeliveryTargetPipe = v.discriminate((value) => value.type, {
	'source-control': v.object({
		type: v.eq('source-control'),
		repositoryId: idPipe,
		targetBranch: nonEmptyTrimmedStringPipe,
	}),
})
export type ProposedDeliveryTarget = PipeOutput<typeof proposedDeliveryTargetPipe>
export type ProposedSourceControlDeliveryTarget = Extract<ProposedDeliveryTarget, { type: 'source-control' }>

export const proposedSlicePipe = v.object({
	order: nonNegativeIntegerPipe,
	title: nonEmptyTrimmedStringPipe,
	instruction: instructionSourcePipe,
	dependsOnProposedSliceKeys: dependencySetPipe,
})
export type ProposedSlice = PipeOutput<typeof proposedSlicePipe>

export const proposedDeliveryPipe = v.object({
	title: nonEmptyTrimmedStringPipe,
	target: proposedDeliveryTargetPipe,
	slices: v.record(proposedKeyPipe, proposedSlicePipe),
	dependsOnDeliveryIds: existingIdSetPipe,
	dependsOnProposedDeliveryKeys: dependencySetPipe,
})
export type ProposedDelivery = PipeOutput<typeof proposedDeliveryPipe>

export interface ProposedChildMemoryCreationShape {
	title: string
	body: string
	children: Record<string, ProposedChildMemoryCreationShape>
}

export interface ProposedMemoryCreationShape {
	parentId: string | null
	title: string
	body: string
	children: Record<string, ProposedChildMemoryCreationShape>
}

export const proposedChildMemoryCreationPipe: Pipe<unknown, ProposedChildMemoryCreationShape> = v.recursive(
	() =>
		v.object({
			title: nonEmptyTrimmedStringPipe,
			body: freeFormStringPipe,
			children: v.record(proposedKeyPipe, proposedChildMemoryCreationPipe),
		}),
	'ProposedChildMemoryCreation',
)
export type ProposedChildMemoryCreation = PipeOutput<typeof proposedChildMemoryCreationPipe>

export const proposedMemoryCreationPipe: Pipe<unknown, ProposedMemoryCreationShape> = v.object({
	parentId: v.nullable(idPipe),
	title: nonEmptyTrimmedStringPipe,
	body: freeFormStringPipe,
	children: v.record(proposedKeyPipe, proposedChildMemoryCreationPipe),
})
export type ProposedMemoryCreation = PipeOutput<typeof proposedMemoryCreationPipe>

export const proposedMemoryRevisionPipe = v.object({
	expectedCurrentRevisionId: idPipe,
	title: nonEmptyTrimmedStringPipe,
	body: freeFormStringPipe,
})
export type ProposedMemoryRevision = PipeOutput<typeof proposedMemoryRevisionPipe>

export const rawPlanOutputProposalPipe = v.object({
	proposedDeliveries: v.record(proposedKeyPipe, proposedDeliveryPipe),
	proposedMemoryCreations: v.record(proposedKeyPipe, proposedMemoryCreationPipe),
	proposedMemoryRevisions: v.record(idPipe, proposedMemoryRevisionPipe),
})
type RawPlanOutputProposal = PipeOutput<typeof rawPlanOutputProposalPipe>

export const planOutputProposalPipe = rawPlanOutputProposalPipe.pipe(
	v.custom<RawPlanOutputProposal>(isStructurallyValidPlanOutputProposal, 'Expected a structurally valid non-empty Plan Output proposal.'),
)
export type PlanOutputProposal = PipeOutput<typeof planOutputProposalPipe>

export const revisionDispositionPipe = v.object({ body: freeFormStringPipe })
export type RevisionDisposition = PipeOutput<typeof revisionDispositionPipe>

export const revisionOutputProposalPipe = v.object({
	instruction: instructionSourcePipe,
	disposition: revisionDispositionPipe,
})
export type RevisionOutputProposal = PipeOutput<typeof revisionOutputProposalPipe>

function isStructurallyValidPlanOutputProposal(output: RawPlanOutputProposal): boolean {
	return (
		hasAnyOutput(output) &&
		proposedDeliveriesAreStructurallyValid(output.proposedDeliveries) &&
		proposedMemoryCreationKeysAreGloballyUnique(output.proposedMemoryCreations)
	)
}

function hasAnyOutput(output: RawPlanOutputProposal): boolean {
	return [output.proposedDeliveries, output.proposedMemoryCreations, output.proposedMemoryRevisions].some(hasKeys)
}

function hasKeys(record: Record<string, unknown>): boolean {
	return Object.keys(record).length > 0
}

function proposedDeliveriesAreStructurallyValid(deliveries: Record<string, ProposedDelivery>): boolean {
	return (
		deliveryDependenciesAreKnownAndAcyclic(deliveries) &&
		Object.entries(deliveries).every(([deliveryKey, delivery]) => proposedDeliveryIsStructurallyValid(deliveryKey, delivery))
	)
}

function proposedDeliveryIsStructurallyValid(deliveryKey: string, delivery: ProposedDelivery): boolean {
	return (
		hasKeys(delivery.slices) &&
		deliveryDependsOnNoSelf(deliveryKey, delivery) &&
		sliceOrdersAreContiguous(delivery.slices) &&
		sliceDependenciesAreKnownAndAcyclic(delivery.slices)
	)
}

function deliveryDependsOnNoSelf(deliveryKey: string, delivery: ProposedDelivery): boolean {
	return delivery.dependsOnProposedDeliveryKeys[deliveryKey] === undefined
}

function deliveryDependenciesAreKnownAndAcyclic(deliveries: Record<string, ProposedDelivery>): boolean {
	const keys = new Set(Object.keys(deliveries))
	return (
		Object.entries(deliveries).every(([deliveryKey, delivery]) =>
			Object.keys(delivery.dependsOnProposedDeliveryKeys).every((dependency) => dependency !== deliveryKey && keys.has(dependency)),
		) &&
		!hasCycle(
			Object.fromEntries(
				Object.entries(deliveries).map(([key, delivery]) => [key, Object.keys(delivery.dependsOnProposedDeliveryKeys)]),
			),
		)
	)
}

function sliceOrdersAreContiguous(slices: Record<string, ProposedSlice>): boolean {
	const orders = Object.values(slices)
		.map((slice) => slice.order)
		.sort((left, right) => left - right)
	return orders.every((order, index) => order === index)
}

function sliceDependenciesAreKnownAndAcyclic(slices: Record<string, ProposedSlice>): boolean {
	const keys = new Set(Object.keys(slices))
	return (
		Object.entries(slices).every(([sliceKey, slice]) =>
			Object.keys(slice.dependsOnProposedSliceKeys).every((dependency) => dependency !== sliceKey && keys.has(dependency)),
		) &&
		!hasCycle(Object.fromEntries(Object.entries(slices).map(([key, slice]) => [key, Object.keys(slice.dependsOnProposedSliceKeys)])))
	)
}

function hasCycle(graph: Record<string, string[]>): boolean {
	const visiting = new Set<string>()
	const visited = new Set<string>()
	return Object.keys(graph).some((node) => visitsCycle(node, graph, visiting, visited))
}

function visitsCycle(node: string, graph: Record<string, string[]>, visiting: Set<string>, visited: Set<string>): boolean {
	if (visited.has(node)) return false
	if (visiting.has(node)) return true

	visiting.add(node)
	for (const dependency of graph[node] ?? []) {
		if (visitsCycle(dependency, graph, visiting, visited)) return true
	}
	visiting.delete(node)
	visited.add(node)
	return false
}

function proposedMemoryCreationKeysAreGloballyUnique(memories: Record<string, ProposedMemoryCreation>): boolean {
	const keys = new Set<string>()
	return Object.entries(memories).every(([key, memory]) => collectUniqueMemoryCreationKeys(key, memory.children, keys))
}

function collectUniqueMemoryCreationKeys(key: string, children: Record<string, ProposedChildMemoryCreation>, keys: Set<string>): boolean {
	if (keys.has(key)) return false
	keys.add(key)
	return Object.entries(children).every(([childKey, child]) => collectUniqueMemoryCreationKeys(childKey, child.children, keys))
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Plan Output proposal pipe', () => {
		it('accepts keyed delivery, memory creation, and memory revision proposals', () => {
			expect(v.validate(planOutputProposalPipe, validOutput())).toMatchObject({ valid: true })
		})

		it('rejects empty outputs before a proposal event can be recorded', () => {
			expect(v.validate(planOutputProposalPipe, emptyOutput())).toMatchObject({ valid: false })
		})

		it('rejects non-contiguous slice orders and unknown same-delivery slice dependencies', () => {
			expect(v.validate(planOutputProposalPipe, outputWithSliceOrderGap())).toMatchObject({ valid: false })
			expect(v.validate(planOutputProposalPipe, outputWithUnknownSliceDependency())).toMatchObject({ valid: false })
		})

		it('rejects proposed dependency cycles', () => {
			expect(v.validate(planOutputProposalPipe, outputWithDeliveryCycle())).toMatchObject({ valid: false })
			expect(v.validate(planOutputProposalPipe, outputWithSliceCycle())).toMatchObject({ valid: false })
		})

		it('rejects duplicate proposed Memory keys across the creation tree', () => {
			expect(v.validate(planOutputProposalPipe, outputWithDuplicateNestedMemoryKey())).toMatchObject({ valid: false })
		})
	})

	function emptyOutput(): RawPlanOutputProposal {
		return { proposedDeliveries: {}, proposedMemoryCreations: {}, proposedMemoryRevisions: {} }
	}

	function validOutput(): RawPlanOutputProposal {
		return {
			proposedDeliveries: {
				'01k00000000000000000100029': {
					title: 'Delivery A',
					target: { type: 'source-control', repositoryId: '01k00000000000000000000034', targetBranch: 'main' },
					slices: {
						'01k00000000000000000100038': {
							order: 0,
							title: 'Slice A',
							instruction: { body: 'Do A.' },
							dependsOnProposedSliceKeys: {},
						},
						'01k00000000000000000100039': {
							order: 1,
							title: 'Slice B',
							instruction: { body: 'Do B.' },
							dependsOnProposedSliceKeys: { '01k00000000000000000100038': true },
						},
					},
					dependsOnDeliveryIds: { '01k00000000000000000100032': true },
					dependsOnProposedDeliveryKeys: {},
				},
			},
			proposedMemoryCreations: {
				'01k00000000000000000100001': {
					parentId: null,
					title: 'Memory A',
					body: 'Remember A.',
					children: {
						'01k00000000000000000100002': { title: 'Memory B', body: 'Remember B.', children: {} },
					},
				},
			},
			proposedMemoryRevisions: {
				'01k00000000000000000100009': {
					expectedCurrentRevisionId: '01k00000000000000000100010',
					title: 'Memory',
					body: 'Updated.',
				},
			},
		}
	}

	function outputWithSliceOrderGap(): RawPlanOutputProposal {
		return {
			...emptyOutput(),
			proposedDeliveries: {
				'01k00000000000000000100029': {
					title: 'Delivery A',
					target: { type: 'source-control', repositoryId: '01k00000000000000000000034', targetBranch: 'main' },
					slices: {
						'01k00000000000000000100038': {
							order: 0,
							title: 'Slice A',
							instruction: { body: 'Do A.' },
							dependsOnProposedSliceKeys: {},
						},
						'01k00000000000000000100039': {
							order: 2,
							title: 'Slice B',
							instruction: { body: 'Do B.' },
							dependsOnProposedSliceKeys: {},
						},
					},
					dependsOnDeliveryIds: {},
					dependsOnProposedDeliveryKeys: {},
				},
			},
		}
	}

	function outputWithUnknownSliceDependency(): RawPlanOutputProposal {
		const output = validOutput()
		output.proposedDeliveries['01k00000000000000000100029']!.slices['01k00000000000000000100038']!.dependsOnProposedSliceKeys = {
			missing: true,
		}
		return output
	}

	function outputWithDeliveryCycle(): RawPlanOutputProposal {
		const output = validOutput()
		output.proposedDeliveries['01k00000000000000000100030'] = {
			title: 'Delivery B',
			target: { type: 'source-control', repositoryId: '01k00000000000000000000034', targetBranch: 'main' },
			slices: {
				'01k00000000000000000100040': {
					order: 0,
					title: 'Slice C',
					instruction: { body: 'Do C.' },
					dependsOnProposedSliceKeys: {},
				},
			},
			dependsOnDeliveryIds: {},
			dependsOnProposedDeliveryKeys: { '01k00000000000000000100029': true },
		}
		output.proposedDeliveries['01k00000000000000000100029']!.dependsOnProposedDeliveryKeys = { '01k00000000000000000100030': true }
		return output
	}

	function outputWithSliceCycle(): RawPlanOutputProposal {
		const output = validOutput()
		output.proposedDeliveries['01k00000000000000000100029']!.slices['01k00000000000000000100038']!.dependsOnProposedSliceKeys = {
			'01k00000000000000000100039': true,
		}
		output.proposedDeliveries['01k00000000000000000100029']!.slices['01k00000000000000000100039']!.dependsOnProposedSliceKeys = {
			'01k00000000000000000100038': true,
		}
		return output
	}

	function outputWithDuplicateNestedMemoryKey(): RawPlanOutputProposal {
		const output = validOutput()
		output.proposedMemoryCreations['01k00000000000000000100003'] = {
			parentId: null,
			title: 'Memory C',
			body: 'Remember C.',
			children: { '01k00000000000000000100001': { title: 'Duplicate', body: '', children: {} } },
		}
		return output
	}
}
