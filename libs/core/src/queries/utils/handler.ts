import { v, type Pipe, type PipeInput, type PipeOutput } from 'valleyed'

import type { InvalidInputError } from '../../errors'
import type { Result } from '../../utils/types'
import { validateCoreInput } from '../../validation'

export const buildQueryHandler =
	<TPipe extends Pipe<unknown, unknown>, TValue, TError>(
		operation: string,
		inputPipe: TPipe,
		handler: (input: PipeOutput<TPipe>) => Promise<Result<TValue, TError>>,
	): ((input: PipeInput<TPipe>) => Promise<Result<TValue, TError | InvalidInputError>>) =>
	async (input: PipeInput<TPipe>) => {
		const validation = validateCoreInput(v.object({ input: inputPipe }), { input }, 'query', operation)

		if (!validation.ok) return validation

		return handler(validation.value.input)
	}
