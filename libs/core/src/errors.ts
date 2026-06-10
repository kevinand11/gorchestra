import type { PipeError } from 'valleyed'

import type {
	AgentRunPurpose,
	DeliveryId,
	DeliveryWorkState,
	ExternalOperationEvidence,
	ModelId,
	ModelProviderId,
	RevisionGateId,
	ValidationEvidence,
} from './model'

export type CorePreflightCheckName = 'storage' | 'secrets' | 'sandbox' | 'clock' | 'idGenerator'

export type CoreInputBoundary = 'construction' | 'snapshot-import' | 'command' | 'query'

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
	service: CorePreflightCheckName
	operation: string
	pipeError: PipeError
}

export type OpenCoreError = InvalidInputError

export type DeliveryWorkStateType = DeliveryWorkState['type']

export type CoreResource =
	| 'portfolio-config'
	| 'project'
	| 'repository'
	| 'model-provider'
	| 'model'
	| 'plan'
	| 'delivery'
	| 'slice'
	| 'link'
	| 'memory'
	| 'delivery-artifact'
	| 'slice-artifact'
	| 'action'
	| 'agent-run'
	| 'review-surface'
	| 'revision-gate'
	| 'revision'
	| 'secret'
	| 'secret-binding'

export interface ResourceNotFoundError {
	type: 'not-found'
	resource: CoreResource
	id: string
}

export type CoreStorageOperation =
	| { type: 'get'; resource: CoreResource; id: string | null }
	| { type: 'put'; resource: CoreResource; id: string | null }
	| { type: 'list'; resource: CoreResource }

export interface StorageOperationFailedError {
	type: 'storage-operation-failed'
	operation: CoreStorageOperation
}

export interface InvariantViolationError {
	type: 'invariant-violation'
	message: string
}

export interface ModelPreflightFailedError {
	type: 'model-preflight-failed'
	modelId: ModelId
	evidence: ValidationEvidence
}

export interface DeliveryWorkStateMismatchError {
	type: 'delivery-work-state-mismatch'
	deliveryId: DeliveryId
	expected: DeliveryWorkStateType[]
	actual: DeliveryWorkState
}

export interface RevisionGateClosedError {
	type: 'revision-gate-closed'
	revisionGateId: RevisionGateId
}

export interface AgentRunModelUnresolvedError {
	type: 'agent-run-model-unresolved'
	purpose: AgentRunPurpose
}

export interface ArchivedModelError {
	type: 'archived-model'
	modelId: ModelId
}

export interface ArchivedModelProviderError {
	type: 'archived-model-provider'
	modelProviderId: ModelProviderId
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
	| StorageOperationFailedError
	| InvariantViolationError
	| ModelPreflightFailedError
	| DeliveryWorkStateMismatchError
	| RevisionGateClosedError
	| AgentRunModelUnresolvedError
	| ArchivedModelError
	| ArchivedModelProviderError
	| ExternalOperationFailedError

export type CommandStubError = InvalidInputError | NotImplementedError
export type WorkStateQueryError = InvalidInputError | NotImplementedError
export type CorePreflightError = InvalidCoreServiceOutputError
export type ImportSnapshotError = InvalidInputError | NotImplementedError
