import type { Action } from '../domain/action'
import type { AgentRun } from '../domain/agent-run'
import type { DeliveryArtifact, SliceArtifact } from '../domain/artifact'
import type { PortfolioConfigRecord, ProjectConfigRecord } from '../domain/config'
import type { Delivery } from '../domain/delivery'
import type { Project } from '../domain/project'
import type { Repository } from '../domain/repository'
import type { ReviewSurface } from '../domain/review-surface'
import type { Slice } from '../domain/slice'
import type { DeliveryDependencyLink, SliceDependencyLink } from './work-state/types'

export interface DeliveryDependencySummary {
	link: DeliveryDependencyLink
	delivery: Delivery
	closedBy: Action | null
}

export interface StoredDeliveryContext {
	delivery: Delivery
	project: Project
	repository: Repository
	portfolioConfig: PortfolioConfigRecord | null
	projectConfig: ProjectConfigRecord | null
	slices: Slice[]
	actions: Action[]
	agentRuns: AgentRun[]
	deliveryArtifacts: DeliveryArtifact[]
	sliceArtifacts: SliceArtifact[]
	reviewSurfaces: ReviewSurface[]
	deliveryDependencies: DeliveryDependencySummary[]
	sliceDependencyLinks: SliceDependencyLink[]
}
