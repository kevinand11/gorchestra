import type { CoreError, CoreIdResource } from '@gorchestra/core'
import {
	BadRequestError,
	NotAuthenticatedError,
	NotAuthorizedError,
	NotFoundError,
	PreconditionRequiredError,
	RequestError,
	TokenExpired,
} from 'equipped/errors'

import type { ApiSessionAuthentication } from './session'
import type { WorkspacePortfolioAccessFailureReason } from '../modules/selection-access'

export function throwSessionAuthenticationError(reason: Extract<ApiSessionAuthentication, { authenticated: false }>['reason']): never {
	if (reason === 'expired') throw new TokenExpired()
	throw new NotAuthenticatedError()
}

class PortfolioCoreUnavailableError extends RequestError {
	constructor() {
		const message = 'Selected Portfolio is temporarily unavailable'
		super(message, 503, [{ message }])
	}
}

class ConflictError extends RequestError {
	constructor(message: string) {
		super(message, 409, [{ message }])
	}
}

export function throwBadRequest(message: string): never {
	throw new BadRequestError(message)
}

export function throwNotAuthorized(message = 'Not authorized'): never {
	throw new NotAuthorizedError(message)
}

export function throwSelectionAccessError(reason: WorkspacePortfolioAccessFailureReason): never {
	if (reason === 'user-not-found') throw new NotAuthenticatedError()
	throw new NotAuthorizedError('Selected Workspace and Portfolio are not accessible')
}

export function throwSelectionRequired(): never {
	throw new PreconditionRequiredError('Select a Workspace and Portfolio before using this API.')
}

export function throwPortfolioCoreUnavailable(): never {
	throw new PortfolioCoreUnavailableError()
}

export function throwCoreOperationError(error: CoreError): never {
	const message = coreErrorMessage(error)
	const status = coreErrorHttpStatus(error)
	switch (status) {
		case 'bad-request':
			throw new BadRequestError(message)
		case 'conflict':
			throw new ConflictError(message)
		case 'not-found':
			throw new NotFoundError(message)
		case 'internal':
			throw new Error(`Core operation failed: ${message}`)
		default:
			return exhaustive(status)
	}
}

type CoreErrorHttpStatus = 'bad-request' | 'conflict' | 'not-found' | 'internal'

function coreErrorHttpStatus(error: CoreError): CoreErrorHttpStatus {
	switch (error.type) {
		case 'invalid-input':
		case 'resource-archived':
		case 'resource-not-archived':
		case 'duplicate-agent-run-runtime-requirement':
		case 'duplicate-link':
		case 'model-preflight-failed':
		case 'model-not-selectable':
		case 'duplicate-repository-target':
		case 'project-source-type-mismatch':
		case 'invalid-plan-output':
		case 'revision-gate-closed':
		case 'delivery-closed':
		case 'plan-closed':
		case 'review-surface-already-merged':
		case 'agent-run-model-unresolved':
		case 'agent-run-model-use-unresolved':
		case 'model-thinking-level-unavailable':
		case 'agent-run-not-interactive':
		case 'agent-run-not-active':
		case 'agent-run-turn-active':
		case 'proposal-already-reviewed':
		case 'proposal-type-mismatch':
		case 'agent-run-purpose-mismatch':
			return 'bad-request'
		case 'revision-conflict':
		case 'delivery-preflight-claim-conflict':
		case 'delivery-work-state-mismatch':
			return 'conflict'
		case 'not-found':
			return 'not-found'
		case 'invalid-core-service-output':
		case 'not-implemented':
		case 'storage-operation-failed':
		case 'invariant-violation':
		case 'secret-resolution-failed':
		case 'sandbox-operation-failed':
		case 'sandbox-provider-resolution-failed':
		case 'external-operation-failed':
		case 'dispatch-attempt-aborted':
		case 'dispatch-fence-lost':
		case 'dispatch-processor-already-started':
		case 'dispatch-storage-incompatible':
			return 'internal'
		default:
			return exhaustive(error)
	}
}

function coreErrorMessage(error: CoreError): string {
	switch (error.type) {
		case 'invalid-input':
			return 'Invalid Core input'
		case 'invalid-core-service-output':
			return `Core ${error.service} service returned invalid output`
		case 'not-implemented':
			return 'Core operation is not implemented'
		case 'not-found':
			return `${coreResourceLabel(error.resource)} was not found`
		case 'resource-archived':
			return `${coreResourceLabel(error.resource)} is archived`
		case 'resource-not-archived':
			return `${coreResourceLabel(error.resource)} is not archived`
		case 'storage-operation-failed':
			return 'Core storage operation failed'
		case 'duplicate-agent-run-runtime-requirement':
			return 'Runtime Requirement already exists'
		case 'duplicate-link':
			return 'Link already exists'
		case 'invariant-violation':
			return 'Core invariant violation'
		case 'model-preflight-failed':
			return error.evidence.summary
		case 'model-not-selectable':
			return modelNotSelectableMessage(error)
		case 'secret-resolution-failed':
			return 'Secret could not be resolved'
		case 'sandbox-operation-failed':
			return error.summary
		case 'sandbox-provider-resolution-failed':
			return error.summary
		case 'delivery-preflight-claim-conflict':
			return 'Delivery preflight is already claimed'
		case 'duplicate-repository-target':
			return `Repository target ${error.owner}/${error.name} already exists for this Project`
		case 'project-source-type-mismatch':
			return projectSourceTypeMismatchMessage(error)
		case 'delivery-work-state-mismatch':
			return 'Delivery is not in the required work state'
		case 'invalid-plan-output':
			return invalidPlanOutputMessage(error)
		case 'revision-conflict':
			return 'Memory was changed by another revision'
		case 'revision-gate-closed':
			return 'Revision Gate is closed'
		case 'delivery-closed':
			return 'Delivery is closed'
		case 'plan-closed':
			return 'Plan is closed'
		case 'review-surface-already-merged':
			return 'Review Surface is already merged'
		case 'agent-run-model-unresolved':
			return 'Agent Run Model is not configured'
		case 'agent-run-model-use-unresolved':
			return 'Agent Run Model Use is not configured'
		case 'model-thinking-level-unavailable':
			return 'Model Thinking Level is unavailable'
		case 'agent-run-not-interactive':
			return 'Agent Run is not interactive'
		case 'agent-run-not-active':
			return 'Agent Run is not active'
		case 'agent-run-turn-active':
			return 'Agent Run has an active turn'
		case 'proposal-already-reviewed':
			return 'Proposal has already been reviewed'
		case 'proposal-type-mismatch':
			return 'Proposal type does not match the requested operation'
		case 'agent-run-purpose-mismatch':
			return 'Agent Run purpose does not match the requested operation'
		case 'external-operation-failed':
			return error.evidence.summary
		case 'dispatch-attempt-aborted':
			return 'Core Dispatch attempt was aborted'
		case 'dispatch-fence-lost':
			return 'Core Dispatch attempt lost its fence'
		case 'dispatch-processor-already-started':
			return 'Core Dispatch Processor is already started'
		case 'dispatch-storage-incompatible':
			return 'Core Dispatch storage is incompatible'
		default:
			return exhaustive(error)
	}
}

function coreResourceLabel(resource: CoreIdResource): string {
	switch (resource) {
		case 'project':
			return 'Project'
		case 'repository':
			return 'Repository'
		case 'model-provider':
			return 'Model Provider'
		case 'model':
			return 'Model'
		case 'agent-run-profile':
			return 'Agent Run Profile'
		case 'plan':
			return 'Plan'
		case 'delivery':
			return 'Delivery'
		case 'slice':
			return 'Slice'
		case 'link':
			return 'Link'
		case 'memory':
			return 'Memory'
		case 'memory-revision':
			return 'Memory Revision'
		case 'delivery-artifact':
			return 'Delivery Artifact'
		case 'slice-artifact':
			return 'Slice Artifact'
		case 'action':
			return 'Action'
		case 'agent-run':
			return 'Agent Run'
		case 'agent-run-event':
			return 'Agent Run Event'
		case 'review-surface':
			return 'Review Surface'
		case 'revision-gate':
			return 'Revision Gate'
		case 'revision':
			return 'Revision'
		case 'secret':
			return 'Secret'
		case 'dispatch-request':
			return 'Dispatch Request'
		case 'dispatch-coordination':
			return 'Dispatch Coordination'
		default:
			return exhaustive(resource)
	}
}

function modelNotSelectableMessage(error: Extract<CoreError, { type: 'model-not-selectable' }>): string {
	switch (error.reason) {
		case 'model-archived':
			return 'Model is archived'
		case 'provider-archived':
			return 'Model Provider is archived'
		default:
			return exhaustive(error.reason)
	}
}

function projectSourceTypeMismatchMessage(error: Extract<CoreError, { type: 'project-source-type-mismatch' }>): string {
	switch (error.expected) {
		case 'source-control':
			return 'Project does not support source control Repositories'
		default:
			return exhaustive(error.expected)
	}
}

function invalidPlanOutputMessage(error: Extract<CoreError, { type: 'invalid-plan-output' }>): string {
	switch (error.reason) {
		case 'empty-output':
			return 'Plan output is empty'
		case 'delivery-without-slices':
			return `Plan output Delivery ${error.proposedDeliveryKey} has no Slices`
		case 'duplicate-proposed-delivery-key':
			return `Plan output contains duplicate Delivery key ${error.proposedDeliveryKey}`
		case 'duplicate-proposed-slice-key':
			return `Plan output contains duplicate Slice key ${error.proposedSliceKey}`
		case 'duplicate-proposed-memory-key':
			return `Plan output contains duplicate Memory key ${error.proposedMemoryKey}`
		case 'unknown-proposed-delivery-key':
			return `Plan output references unknown Delivery key ${error.proposedDeliveryKey}`
		case 'unknown-proposed-slice-key':
			return `Plan output references unknown Slice key ${error.proposedSliceKey}`
		case 'unknown-proposed-memory-key':
			return `Plan output references unknown Memory key ${error.proposedMemoryKey}`
		case 'unknown-link-def-ref':
			return 'Plan output references an unknown Link target'
		case 'repository-project-mismatch':
			return `Plan output Delivery ${error.proposedDeliveryKey} references a Repository from another Project`
		case 'project-boundary-mismatch':
			return 'Plan output contains a Link outside the Project boundary'
		case 'invalid-link-def':
			return 'Plan output contains an invalid Link'
		case 'duplicate-link':
			return 'Plan output contains a duplicate Link'
		case 'delivery-dependency-cycle':
			return 'Plan output contains a Delivery dependency cycle'
		case 'slice-dependency-cycle':
			return `Plan output Delivery ${error.proposedDeliveryKey} contains a Slice dependency cycle`
		case 'stale-memory-revision':
			return 'Plan output references a stale Memory Revision'
		case 'noop-memory-revision':
			return 'Plan output contains an unchanged Memory Revision'
		case 'memory-supersession-cycle':
			return 'Plan output contains a Memory supersession cycle'
		default:
			return exhaustive(error)
	}
}

function exhaustive(value: never): never {
	throw new Error(`Unexpected Core error variant: ${String(value)}`)
}
