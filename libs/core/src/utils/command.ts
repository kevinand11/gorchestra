import { v, type Pipe, type PipeInput, type PipeOutput } from 'valleyed'

import { operationContextPipe, type OperationContext } from '../domain/commons'
import type { CommandStubError, InvalidInputError, NotImplementedError } from '../errors'
import type { Result } from '../utils/types'
import { validateCoreInput } from '../validation'

export const buildCommandHandler =
	<T extends Pipe<unknown, unknown>, TValue, TError>(
		operation: string,
		inputPipe: T,
		handler: (input: PipeOutput<T>, context: OperationContext) => Promise<Result<TValue, TError>>,
	): ((input: PipeInput<T>, context: OperationContext) => Promise<Result<TValue, TError | InvalidInputError>>) =>
	async (input: PipeInput<T>, context: OperationContext) => {
		const validation = validateCoreInput(
			v.object({ input: inputPipe, context: operationContextPipe }),
			{ input, context },
			'command',
			operation,
		)

		if (!validation.ok) return validation

		return handler(validation.value.input, validation.value.context)
	}

export function buildStubCommand<T, TPipe extends Pipe<unknown, unknown> = Pipe<unknown, unknown>>(
	operation: string,
	inputPipe: TPipe,
): (input: PipeInput<TPipe>, context: OperationContext) => Promise<Result<T, CommandStubError>> {
	return buildCommandHandler(operation, inputPipe, () => Promise.resolve(notImplemented<T>(operation)))
}

function notImplemented<T>(operation: string): Result<T, NotImplementedError> {
	return { ok: false, error: { type: 'not-implemented', operation } }
}
