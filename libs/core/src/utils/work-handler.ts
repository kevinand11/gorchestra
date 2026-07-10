import { v, type Pipe, type PipeInput, type PipeOutput } from 'valleyed'

import type { InvalidInputError } from '../errors'
import type { Result } from './types'
import { validateCoreInput } from '../validation'
import { workContextPipe, type WorkContext } from '../work/types'

export const buildWorkHandler =
	<T extends Pipe<unknown, unknown>, TValue, TError>(
		operation: string,
		inputPipe: T,
		handler: (input: PipeOutput<T>, context: WorkContext) => Promise<Result<TValue, TError>>,
	): ((input: PipeInput<T>, context: WorkContext) => Promise<Result<TValue, TError | InvalidInputError>>) =>
	async (input: PipeInput<T>, context: WorkContext) => {
		const validation = validateCoreInput(
			v.object({ input: inputPipe, context: workContextPipe }),
			{ input, context },
			'work',
			operation,
		)

		if (!validation.ok) return validation

		return handler(validation.value.input, validation.value.context)
	}
