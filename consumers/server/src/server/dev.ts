import { pathToFileURL } from 'node:url'

import { Instance } from 'equipped'

import { createServerApiServer } from './api/app'
import { createServerApiContext } from './api/context'
import { readServerEnv } from './env'
import { createDeferredServerConsumerNotFoundHandler } from './runtime/not-found'
import { createNuxtDevRuntime, type NuxtDevRuntime } from './runtime/nuxt-dev'
import { startServerStorage } from './storage/repo'

export async function startServerConsumerDev(): Promise<boolean> {
	const env = readServerEnv()
	const serverStorage = await startServerStorage({ dataDir: env.GORCHESTRA_DATA_DIR })
	const context = createServerApiContext({ serverStorage, env })
	let nuxtRuntime: NuxtDevRuntime | null = null
	const server = createServerApiServer(context, env)
	server.setNotFoundHandler(createDeferredServerConsumerNotFoundHandler(() => nuxtRuntime?.listener ?? null))
	server.onBeforeListen(async ({ httpServer, port }) => {
		nuxtRuntime = await createNuxtDevRuntime({ httpServer, port })
		Instance.on('close', async () => await nuxtRuntime?.close())
	})
	return server.start()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await startServerConsumerDev()
}
