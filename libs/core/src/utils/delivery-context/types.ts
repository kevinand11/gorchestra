import type { DeliveryDependencyLink, SliceDependencyLink } from './work-state/types'
import type { Action } from '../../domain/action'
import type { AgentRun } from '../../domain/agent-run'
import type { DeliveryArtifact, SliceArtifact } from '../../domain/artifact'
import type { Delivery } from '../../domain/delivery'
import type { Project } from '../../domain/project'
import type { Repository } from '../../domain/repository'
import type { ReviewSurface } from '../../domain/review-surface'
import type { Slice } from '../../domain/slice'

export interface DeliveryDependencySummary {
	link: DeliveryDependencyLink
	delivery: Delivery
}

export interface DeliveryContextSlice {
	slice: Slice
	artifact: SliceArtifact | null
	dependencyLinks: SliceDependencyLink[]
}

export interface DeliveryContext {
	delivery: Delivery
	project: Project
	repository: Repository
	deliveryArtifact: DeliveryArtifact | null
	slices: DeliveryContextSlice[]
	actions: Action[]
	agentRuns: AgentRun[]
	reviewSurfaces: ReviewSurface[]
	deliveryDependencies: DeliveryDependencySummary[]
}
