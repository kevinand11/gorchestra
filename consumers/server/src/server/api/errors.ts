import {
	BadRequestError,
	NotAuthenticatedError,
	NotAuthorizedError,
	NotFoundError,
	PreconditionRequiredError,
	TokenExpired,
} from 'equipped/errors'

import type { ApiSessionAuthentication } from './session'
import type { WorkspacePortfolioAccessFailureReason } from '../modules/selection-access'

export function throwSessionAuthenticationError(reason: Extract<ApiSessionAuthentication, { authenticated: false }>['reason']): never {
	if (reason === 'expired') throw new TokenExpired()
	throw new NotAuthenticatedError()
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

const badRequestCoreErrorMessages: Record<string, string> = {
	'invalid-input': 'Invalid Core input',
	'invalid-memory-link': 'Invalid Memory Link',
	'invalid-link': 'Invalid Link',
	'duplicate-link': 'Link already exists',
	'link-not-archivable': 'Link type cannot be archived',
	'already-archived': 'Resource is already archived',
	'agent-run-model-unresolved': 'Planning Model is not configured',
	'archived-model-reference': 'Selected Model is archived',
	'archived-model-provider-reference': 'Selected Model Provider is archived',
	'duplicate-repository-target': 'Repository target already exists for this Project',
	'project-source-type-mismatch': 'Project does not support source control Repositories',
	'secret-not-active': 'Repository access Secret is not active',
}

export function throwCoreOperationError(error: { type: string; resource?: string }): never {
	const badRequestMessage = badRequestCoreErrorMessages[error.type]
	if (badRequestMessage !== undefined) throw new BadRequestError(badRequestMessage)
	if (error.type === 'not-found') throw new NotFoundError(notFoundCoreResourceMessage(error.resource))
	throw new Error(`Core operation failed: ${error.type}`)
}

function notFoundCoreResourceMessage(resource: string | undefined): string {
	return resource === undefined ? 'Core resource was not found' : `${resource} was not found`
}
