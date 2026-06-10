import { v, type Pipe, type PipeInput } from 'valleyed'

import type { InvalidInputError, NotImplementedError } from '../errors'
import type { Result } from '../types'
import { validateCoreInput } from '../validation'

export function buildQueryStub<T, TPipe extends Pipe<unknown, unknown>>(
	operation: string,
	inputPipe: TPipe,
): (input: PipeInput<TPipe>) => Promise<Result<T, InvalidInputError | NotImplementedError>> {
	return async (input: PipeInput<TPipe>) => {
		const validation = validateCoreInput(v.object({ input: inputPipe }), { input }, 'query', operation)

		if (!validation.ok) {
			return Promise.resolve(validation)
		}

		return { ok: false, error: { type: 'not-implemented', operation } }
	}
}
