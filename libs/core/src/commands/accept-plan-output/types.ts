import type { AuditStamp, Id } from '../../domain/commons'
import type { Delivery } from '../../domain/delivery'
import type { Link } from '../../domain/graph'
import type { Memory } from '../../domain/memory'
import type { PlanOutputProposal, ProposedDelivery, ProposedMemory, ProposedMemoryLink, ProposedSlice } from '../../domain/plan'
import type { Plan } from '../../domain/plan'
import type { Repository } from '../../domain/repository'
import type { Slice } from '../../domain/slice'
import type { InvalidPlanOutputError } from '../../errors'

export interface MaterializedPlanOutput {
	deliveries: Delivery[]
	slices: Slice[]
	memories: Memory[]
	links: Link[]
}

export interface PlannedDelivery {
	proposal: ProposedDelivery
	id: Id
	slices: PlannedSlice[]
}

export interface PlannedSlice {
	proposal: ProposedSlice
	id: Id
	deliveryKey: string
	deliveryId: Id
	order: number
}

export interface PlannedMemory {
	proposal: ProposedMemory
	id: Id
}

export interface PlannedLink {
	id: Id
	type: Link['type']
	from: Link['from']
	to: Link['to']
}

export interface PlanOutputMaterializationPlan {
	plan: Plan
	stamp: AuditStamp
	output: PlanOutputProposal
	deliveries: PlannedDelivery[]
	memories: PlannedMemory[]
	explicitLinks: PlannedLink[]
	deliveryDependencyLinks: PlannedLink[]
	sliceDependencyLinks: PlannedLink[]
	memoryLinks: PlannedLink[]
	producedMemoryLinks: PlannedLink[]
}

export type PlanOutputValidation = { ok: true } | { ok: false; error: InvalidPlanOutputError }

export type ProposedRefResolution = { ok: true; ref: Link['from'] } | { ok: false; error: InvalidPlanOutputError }

export type ExistingRefIndex = {
	repositories: Repository[]
	deliveries: Delivery[]
	slices: Slice[]
	memories: Memory[]
	plans: Plan[]
	links: Link[]
}

export type ProposedLinkSource =
	| { type: 'delivery-existing-dependency'; delivery: PlannedDelivery; dependencyId: Id }
	| { type: 'delivery-proposed-dependency'; delivery: PlannedDelivery; dependencyKey: string }
	| { type: 'slice-dependency'; slice: PlannedSlice; dependencyKey: string }
	| { type: 'memory-link'; memory: PlannedMemory; link: ProposedMemoryLink }
	| { type: 'produced-memory'; memory: PlannedMemory }
