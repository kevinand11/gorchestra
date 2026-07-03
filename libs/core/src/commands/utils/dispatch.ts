import { nonEmptyTrimmedStringPipe } from '../../domain/commons'
import type { CoreDispatchRequest, CoreServices } from '../../services'
import { validateCoreServiceOutput } from '../../validation'

export async function acceptDispatchRequest(dispatcher: CoreServices['dispatcher'], input: CoreDispatchRequest): Promise<string> {
	const marker = await dispatcher.request(input)
	const validated = validateCoreServiceOutput(nonEmptyTrimmedStringPipe, marker, 'dispatcher', 'request')
	if (!validated.ok) throw new Error('Dispatcher request returned an invalid marker.', { cause: validated.error })
	return validated.value
}
