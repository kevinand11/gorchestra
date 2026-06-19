import type { IncomingMessage, ServerResponse } from 'node:http'

export type NuxtNodeListener = (request: IncomingMessage, response: ServerResponse) => unknown

type NuxtNodeListenerModule = {
	listener?: unknown
	default?: unknown
}

const defaultNuxtServerEntry = new URL('../../../.output/server/index.mjs', import.meta.url)

export async function loadNuxtNodeListener(entry: string | URL = defaultNuxtServerEntry): Promise<NuxtNodeListener> {
	const mod = (await import(entry.toString())) as NuxtNodeListenerModule
	const listener = mod.listener ?? mod.default
	if (typeof listener !== 'function') throw new Error(`Nuxt server entry does not export a Node listener: ${entry.toString()}`)
	return listener as NuxtNodeListener
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	function moduleUrl(source: string): string {
		return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`
	}

	describe('Nuxt node listener loader', () => {
		it('loads a named listener export', async () => {
			const listener = await loadNuxtNodeListener(moduleUrl('export const listener = () => "named"'))

			expect(await listener({} as IncomingMessage, {} as ServerResponse)).toBe('named')
		})

		it('loads a default listener export', async () => {
			const listener = await loadNuxtNodeListener(moduleUrl('export default () => "default"'))

			expect(await listener({} as IncomingMessage, {} as ServerResponse)).toBe('default')
		})

		it('rejects a Nuxt server entry without a listener export', async () => {
			await expect(loadNuxtNodeListener(moduleUrl('export const value = 1'))).rejects.toThrow(
				'Nuxt server entry does not export a Node listener',
			)
		})
	})
}
