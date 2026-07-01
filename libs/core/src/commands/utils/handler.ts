import { v, type Pipe, type PipeInput, type PipeOutput } from 'valleyed'

import type { CommandStubError, InvalidInputError, NotImplementedError } from '../../errors'
import type { Result } from '../../utils/types'
import { validateCoreInput } from '../../validation'
import { commandContextPipe, type CommandContext } from '../types'

export const buildCommandHandler =
	<T extends Pipe<unknown, unknown>, TValue, TError>(
		operation: string,
		inputPipe: T,
		handler: (input: PipeOutput<T>, context: CommandContext) => Promise<Result<TValue, TError>>,
	): ((input: PipeInput<T>, context: CommandContext) => Promise<Result<TValue, TError | InvalidInputError>>) =>
	async (input: PipeInput<T>, context: CommandContext) => {
		const validation = validateCoreInput(
			v.object({ input: inputPipe, context: commandContextPipe }),
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
): (input: PipeInput<TPipe>, context: CommandContext) => Promise<Result<T, CommandStubError>> {
	return buildCommandHandler(operation, inputPipe, () => Promise.resolve(notImplemented<T>(operation)))
}

function notImplemented<T>(operation: string): Result<T, NotImplementedError> {
	return { ok: false, error: { type: 'not-implemented', operation } }
}
