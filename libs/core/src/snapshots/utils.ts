import { v, type Pipe, type PipeInput } from 'valleyed'

import type { InvalidInputError, NotImplementedError } from '../errors'
import type { Result } from '../utils/types'
import { validateCoreInput } from '../validation'

export function buildSnapshotStub<T, TPipe extends Pipe<unknown, unknown>>(
	operation: string,
	inputPipe: TPipe,
): (input: PipeInput<TPipe>) => Promise<Result<T, InvalidInputError | NotImplementedError>> {
	return (input: PipeInput<TPipe>) => {
		const validation = validateCoreInput(v.object({ input: inputPipe }), { input }, 'snapshot', operation)

		if (!validation.ok) {
			return Promise.resolve(validation)
		}

		return Promise.resolve(notImplemented<T>(operation))
	}
}

function notImplemented<T>(operation: string): Result<T, NotImplementedError> {
	return { ok: false, error: { type: 'not-implemented', operation } }
}
