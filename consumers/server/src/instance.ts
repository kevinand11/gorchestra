import { Instance } from 'equipped'

export function ensureServerInstance(): Instance {
	const existing = Instance.maybeGet()
	if (existing) return existing

	const instance = Instance.create({
		app: { name: 'gorchestra-server' },
		log: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' },
	})
	instance.alias('server')
	return instance
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	describe('Server Instance', () => {
		it('creates one reusable Equipped Instance for Server Consumer modules', () => {
			const first = ensureServerInstance()
			const second = ensureServerInstance()

			expect(second).toBe(first)
			expect(first.id).toBe('server')
			expect(first.settings.app.name).toBe('gorchestra-server')
		})
	})
}
