import { v, type Pipe, type PipeOutput } from 'valleyed'

import type { CoreInputBoundary, CorePreflightCheckName, InvalidCoreServiceOutputError, InvalidInputError } from './errors'
import type { Result } from './types'

export function validateCoreInput<TPipe extends Pipe<unknown, unknown>>(
	pipe: TPipe,
	value: unknown,
	boundary: CoreInputBoundary,
	operation: string,
): Result<PipeOutput<TPipe>, InvalidInputError> {
	const result = v.validate(pipe, value)

	if (!result.valid) {
		return { ok: false, error: { type: 'invalid-input', boundary, operation, pipeError: result.error } }
	}

	return { ok: true, value: result.value }
}

export function validateCoreServiceOutput<TPipe extends Pipe<unknown, unknown>>(
	pipe: TPipe,
	value: unknown,
	service: CorePreflightCheckName,
	operation: string,
): Result<PipeOutput<TPipe>, InvalidCoreServiceOutputError> {
	const result = v.validate(pipe, value)

	if (!result.valid) {
		return { ok: false, error: { type: 'invalid-core-service-output', service, operation, pipeError: result.error } }
	}

	return { ok: true, value: result.value }
}
