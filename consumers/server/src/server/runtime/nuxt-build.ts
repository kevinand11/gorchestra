import { fileURLToPath } from 'node:url'

import { buildNuxt, loadNuxt } from 'nuxt/kit'

const defaultNuxtRootDir = fileURLToPath(new URL('../../..', import.meta.url))

export async function buildNuxtProductionRuntime(input: { cwd?: string } = {}): Promise<void> {
	const nuxt = await loadNuxt({ cwd: input.cwd ?? defaultNuxtRootDir, dev: false, ready: false })
	try {
		await nuxt.ready()
		await buildNuxt(nuxt)
	} finally {
		await nuxt.close()
	}
}
