import type { PipeError } from 'valleyed'

import type { AgentRunPurpose } from './domain/agent-run'
import type { Id } from './domain/commons'
import type { DeliveryClosedOutcome, DeliveryWorkState } from './domain/delivery'
import type { ExternalOperationEvidence, ValidationEvidence } from './domain/evidence'
import type { LinkDef } from './domain/graph'
import type { ModelThinkingLevel } from './domain/model'
import type { ModelProviderProtocolType } from './domain/model-provider'
import type { SecretBindingScope } from './domain/secret'

export type CorePreflightCheckName = 'storage' | 'secrets' | 'sandbox' | 'dispatcher'
export type CoreServiceOutputName = CorePreflightCheckName | 'runtime'

export type CoreInputBoundary = 'core' | 'command' | 'query' | 'snapshot' | 'work'

export interface InvalidInputError {
	type: 'invalid-input'
	boundary: CoreInputBoundary
	operation: string
	pipeError: PipeError
}

export interface NotImplementedError {
	type: 'not-implemented'
	operation: string
}

export interface InvalidCoreServiceOutputError {
	type: 'invalid-core-service-output'
	service: CoreServiceOutputName
	operation: string
	pipeError: PipeError
}

export type OpenCoreError = InvalidInputError

export type DeliveryWorkStateType = DeliveryWorkState['type']

export type CoreSingletonResource = 'portfolio-config'

export type CoreIdResource =
	| 'project'
	| 'repository'
	| 'model-provider'
	| 'model'
	| 'plan'
	| 'delivery'
	| 'slice'
	| 'link'
	| 'memory'
	| 'memory-revision'
	| 'delivery-artifact'
	| 'slice-artifact'
	| 'action'
	| 'agent-run'
	| 'agent-run-event'
	| 'review-surface'
	| 'revision-gate'
	| 'revision'
	| 'secret'
	| 'secret-binding'

export type CoreResource = CoreSingletonResource | CoreIdResource

export type ArchivableCoreResource = Extract<CoreIdResource, 'model-provider' | 'model' | 'secret' | 'secret-binding'>

export interface ResourceNotFoundError {
	type: 'not-found'
	resource: CoreIdResource
	id: Id
}

export interface SingletonNotFoundError {
	type: 'not-found-singleton'
	resource: CoreSingletonResource
}

export interface AlreadyArchivedError {
	type: 'already-archived'
	resource: ArchivableCoreResource
	id: Id
}

export interface NotArchivedError {
	type: 'not-archived'
	resource: ArchivableCoreResource
	id: Id
}

export type CoreStorageOperation =
	| { type: 'transaction'; cause: unknown }
	| { type: 'get'; resource: CoreResource; id: Id | null }
	| { type: 'list'; resource: CoreIdResource }
	| { type: 'create'; resource: CoreResource; id: Id }
	| { type: 'update'; resource: CoreResource; id: Id }

export interface StorageOperationFailedError {
	type: 'storage-operation-failed'
	operation: CoreStorageOperation
}

export interface DuplicateSecretBindingError {
	type: 'duplicate-secret-binding'
	scope: SecretBindingScope
	envName: string
	existingSecretBindingId: Id
}

export interface ArchivedSecretReferenceError {
	type: 'archived-secret-reference'
	secretId: Id
}

export interface ArchivedModelReferenceError {
	type: 'archived-model-reference'
	modelId: Id
}

export interface ArchivedModelProviderReferenceError {
	type: 'archived-model-provider-reference'
	modelProviderId: Id
}

export interface InvariantViolationError {
	type: 'invariant-violation'
	message: string
}

export interface ModelPreflightFailedError {
	type: 'model-preflight-failed'
	modelId: Id
	evidence: ValidationEvidence
}

export type ModelNotSelectableReason = 'model-archived' | 'provider-archived'

export interface ModelNotSelectableError {
	type: 'model-not-selectable'
	modelId: Id
	reason: ModelNotSelectableReason
}

export interface SecretNotActiveError {
	type: 'secret-not-active'
	secretId: Id
}

export interface DuplicateRepositoryTargetError {
	type: 'duplicate-repository-target'
	projectId: Id
	provider: 'github'
	owner: string
	name: string
}

export interface DuplicateLinkError {
	type: 'duplicate-link'
	def: LinkDef
}

export interface ProjectSourceTypeMismatchError {
	type: 'project-source-type-mismatch'
	projectId: Id
	expected: 'source-control'
	actual: string
}

export interface DeliveryWorkStateMismatchError {
	type: 'delivery-work-state-mismatch'
	deliveryId: Id
	expected: DeliveryWorkStateType[]
	actual: DeliveryWorkState
}

export interface DeliveryPreflightClaimConflictError {
	type: 'delivery-preflight-claim-conflict'
	deliveryId: Id
}

export type InvalidPlanOutputError =
	| { type: 'invalid-plan-output'; reason: 'empty-output' }
	| { type: 'invalid-plan-output'; reason: 'delivery-without-slices'; proposedDeliveryKey: string }
	| { type: 'invalid-plan-output'; reason: 'duplicate-proposed-delivery-key'; proposedDeliveryKey: string }
	| { type: 'invalid-plan-output'; reason: 'duplicate-proposed-slice-key'; proposedSliceKey: string }
	| { type: 'invalid-plan-output'; reason: 'duplicate-proposed-memory-key'; proposedMemoryKey: string }
	| { type: 'invalid-plan-output'; reason: 'unknown-proposed-delivery-key'; proposedDeliveryKey: string }
	| { type: 'invalid-plan-output'; reason: 'unknown-proposed-slice-key'; proposedSliceKey: string }
	| { type: 'invalid-plan-output'; reason: 'unknown-proposed-memory-key'; proposedMemoryKey: string }
	| { type: 'invalid-plan-output'; reason: 'unknown-link-def-ref'; def: LinkDef }
	| { type: 'invalid-plan-output'; reason: 'repository-project-mismatch'; proposedDeliveryKey: string; repositoryId: Id }
	| { type: 'invalid-plan-output'; reason: 'project-boundary-mismatch'; def: LinkDef }
	| { type: 'invalid-plan-output'; reason: 'invalid-link-def'; def: LinkDef }
	| { type: 'invalid-plan-output'; reason: 'duplicate-link'; def: LinkDef }
	| { type: 'invalid-plan-output'; reason: 'delivery-dependency-cycle' }
	| { type: 'invalid-plan-output'; reason: 'slice-dependency-cycle'; proposedDeliveryKey: string }
	| {
			type: 'invalid-plan-output'
			reason: 'stale-memory-revision'
			memoryId: Id
			expectedCurrentRevisionId: Id
			actualCurrentRevisionId: Id
	  }
	| { type: 'invalid-plan-output'; reason: 'noop-memory-revision'; memoryId: Id }
	| { type: 'invalid-plan-output'; reason: 'memory-supersession-cycle' }

export interface RevisionGateClosedError {
	type: 'revision-gate-closed'
	revisionGateId: Id
}

export interface DeliveryClosedError {
	type: 'delivery-closed'
	deliveryId: Id
	outcome: DeliveryClosedOutcome
}

export interface PlanClosedError {
	type: 'plan-closed'
	planId: Id
}

export interface ReviewSurfaceAlreadyMergedError {
	type: 'review-surface-already-merged'
	reviewSurfaceId: Id
}

export interface AgentRunModelUnresolvedError {
	type: 'agent-run-model-unresolved'
	purpose: AgentRunPurpose
}

export interface AgentRunModelUseUnresolvedError {
	type: 'agent-run-model-use-unresolved'
	purpose: AgentRunPurpose
}

export interface ModelThinkingLevelUnavailableError {
	type: 'model-thinking-level-unavailable'
	modelId: Id
	thinkingLevel: ModelThinkingLevel
	reason:
		| { type: 'model-thinking-unconfigured' }
		| { type: 'thinking-level-unconfigured' }
		| { type: 'provider-thinking-level-unsupported'; protocol: ModelProviderProtocolType }
}

export interface AgentRunNotInteractiveError {
	type: 'agent-run-not-interactive'
	agentRunId: Id
}

export interface AgentRunNotActiveError {
	type: 'agent-run-not-active'
	agentRunId: Id
}

export interface AgentRunTurnActiveError {
	type: 'agent-run-turn-active'
	agentRunId: Id
	turnStartedEventId: Id
}

export interface ProposalAlreadyReviewedError {
	type: 'proposal-already-reviewed'
	proposalEventId: Id
}

export interface ProposalTypeMismatchError {
	type: 'proposal-type-mismatch'
	proposalEventId: Id
	expected: 'proposed-plan-output' | 'proposed-revision-output'
	actual: string
}

export interface AgentRunPurposeMismatchError {
	type: 'agent-run-purpose-mismatch'
	agentRunId: Id
	expected: AgentRunPurpose['type'][]
	actual: AgentRunPurpose
}

export interface ExternalOperationFailedError {
	type: 'external-operation-failed'
	evidence: ExternalOperationEvidence
}

/**
 * invariant-violation is reserved for impossible/corrupt states.
 * Expected domain failures should use specific operation error unions.
 */
export type CoreError =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| NotImplementedError
	| ResourceNotFoundError
	| SingletonNotFoundError
	| AlreadyArchivedError
	| NotArchivedError
	| StorageOperationFailedError
	| DuplicateSecretBindingError
	| DuplicateLinkError
	| ArchivedSecretReferenceError
	| ArchivedModelReferenceError
	| ArchivedModelProviderReferenceError
	| InvariantViolationError
	| ModelPreflightFailedError
	| ModelNotSelectableError
	| SecretNotActiveError
	| DeliveryPreflightClaimConflictError
	| DuplicateRepositoryTargetError
	| ProjectSourceTypeMismatchError
	| DeliveryWorkStateMismatchError
	| InvalidPlanOutputError
	| RevisionGateClosedError
	| DeliveryClosedError
	| ReviewSurfaceAlreadyMergedError
	| AgentRunModelUnresolvedError
	| AgentRunModelUseUnresolvedError
	| ModelThinkingLevelUnavailableError
	| AgentRunNotInteractiveError
	| AgentRunNotActiveError
	| ProposalAlreadyReviewedError
	| ProposalTypeMismatchError
	| AgentRunPurposeMismatchError
	| ExternalOperationFailedError

export type CommandStubError = InvalidInputError | NotImplementedError
export type WorkStateQueryError =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError
export type CorePreflightError = InvalidCoreServiceOutputError
