import { BadRequestError, NotAuthenticatedError, NotAuthorizedError, PreconditionRequiredError, TokenExpired } from 'equipped/errors'

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

export function throwCoreOperationError(error: { type: string }): never {
	if (error.type === 'invalid-input') throw new BadRequestError('Invalid Core input')
	throw new Error(`Core operation failed: ${error.type}`)
}
