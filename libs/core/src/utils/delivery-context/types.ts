import type { Action } from '../../domain/action'
import type { AgentRun } from '../../domain/agent-run'
import type { DeliveryArtifact, SliceArtifact } from '../../domain/artifact'
import type { DeliveryWorkConfig, PortfolioConfigRecord, ProjectConfigRecord } from '../../domain/config'
import type { Delivery } from '../../domain/delivery'
import type { ValidationEvidence } from '../../domain/evidence'
import type { Model } from '../../domain/model'
import type { ModelProvider } from '../../domain/model-provider'
import type { Project } from '../../domain/project'
import type { Repository } from '../../domain/repository'
import type { ReviewSurface } from '../../domain/review-surface'
import type { Slice } from '../../domain/slice'
import type { DeliveryPreflightSnapshot } from '../delivery-preflight'
import type { DeliveryDependencyLink, SliceDependencyLink } from './work-state/types'

export interface DeliveryDependencySummary {
	link: DeliveryDependencyLink
	delivery: Delivery
}

export interface StoredDeliverySlice {
	slice: Slice
	artifact: SliceArtifact | null
	dependencyLinks: SliceDependencyLink[]
}

export interface StoredDeliveryContext {
	delivery: Delivery
	project: Project
	repository: Repository
	portfolioConfig: PortfolioConfigRecord | null
	projectConfig: ProjectConfigRecord | null
	deliveryArtifact: DeliveryArtifact | null
	slices: StoredDeliverySlice[]
	actions: Action[]
	agentRuns: AgentRun[]
	reviewSurfaces: ReviewSurface[]
	deliveryDependencies: DeliveryDependencySummary[]
}

export interface ModelProviderResolvedAccess {
	auth: { type: 'apiKey'; plaintext: string } | null
	headers: Array<{ name: string; plaintext: string }>
}

export type RuntimeDeliveryWorkContext = StoredDeliveryContext & {
	workConfig: DeliveryWorkConfig
	executionModel: Model
	executionModelProvider: ModelProvider
	sourceControlAccessToken: { type: 'access-token'; plaintext: string }
	modelProviderAccess: ModelProviderResolvedAccess
}

export type RuntimeDeliveryWorkContextUpgrade =
	| { type: 'runtime-context'; context: RuntimeDeliveryWorkContext; snapshot: DeliveryPreflightSnapshot }
	| { type: 'failed-preflight'; checks: ValidationEvidence[]; snapshot: DeliveryPreflightSnapshot }
