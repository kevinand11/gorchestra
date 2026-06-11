import type { MaterializedPlanOutput, PlanOutputMaterializationPlan, PlannedDelivery, PlannedMemory, PlannedSlice } from './types'
import type { AuditStamp } from '../../domain/commons'
import type { Delivery } from '../../domain/delivery'
import type { Link } from '../../domain/graph'
import type { Memory } from '../../domain/memory'
import type { Slice } from '../../domain/slice'

export function materializePlanOutput(plan: PlanOutputMaterializationPlan): MaterializedPlanOutput {
	return {
		deliveries: plan.deliveries.map((delivery) => materializeDelivery(plan, delivery)),
		slices: plan.deliveries.flatMap((delivery) => delivery.slices.map((slice) => materializeSlice(plan.stamp, slice))),
		memories: plan.memories.map((memory) => materializeMemory(plan.stamp, memory)),
		links: [
			...plan.explicitLinks,
			...plan.deliveryDependencyLinks,
			...plan.sliceDependencyLinks,
			...plan.memoryLinks,
			...plan.producedMemoryLinks,
		].map((link) => materializeLink(plan.stamp, link)),
	}
}

function materializeDelivery(plan: PlanOutputMaterializationPlan, delivery: PlannedDelivery): Delivery {
	return {
		id: delivery.id,
		projectId: plan.plan.projectId,
		planId: plan.plan.id,
		title: delivery.proposal.title,
		target: delivery.proposal.target,
		config: null,
		accepted: plan.stamp,
	}
}

function materializeSlice(stamp: AuditStamp, slice: PlannedSlice): Slice {
	return {
		id: slice.id,
		deliveryId: slice.deliveryId,
		order: slice.order,
		title: slice.proposal.title,
		instruction: slice.proposal.instruction,
		accepted: stamp,
	}
}

function materializeMemory(stamp: AuditStamp, memory: PlannedMemory): Memory {
	return {
		id: memory.id,
		title: memory.proposal.title,
		body: memory.proposal.body,
		type: memory.proposal.type,
		created: stamp,
	}
}

function materializeLink(stamp: AuditStamp, link: Omit<Link, 'created' | 'archivePeriods'>): Link {
	return { ...link, created: stamp, archivePeriods: [] }
}
