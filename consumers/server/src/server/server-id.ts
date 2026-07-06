import { Instance } from 'equipped'
import { v, type PipeOutput } from 'valleyed'

const serverIdPattern = /^[0-9a-hjkmnp-tv-z]{26}$/

export const serverIdPipe = v.string().pipe(
	v.asTrimmed(),
	v.custom((value) => serverIdPattern.test(value), 'Expected a Server id.'),
)
export type ServerId = PipeOutput<typeof serverIdPipe>

export function createServerId(): ServerId {
	return requireServerId(Instance.createId(), 'Equipped generated an invalid Server id')
}

export function requireServerId(value: string, message = 'Server id is required'): ServerId {
	const result = v.validate(serverIdPipe, value)
	if (!result.valid) throw new Error(message)
	return result.value
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server Ids', () => {
		it('generates lowercase monotonic Equipped-format Server ids', () => {
			const first = createServerId()
			const second = createServerId()

			expect(first).toMatch(serverIdPattern)
			expect(second).toMatch(serverIdPattern)
			expect(first < second).toBe(true)
			expect(v.validate(serverIdPipe, ` ${first} `)).toMatchObject({ valid: true, value: first })
			expect(v.validate(serverIdPipe, crypto.randomUUID())).toMatchObject({ valid: false })
		})
	})
}
