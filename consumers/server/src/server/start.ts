import { pathToFileURL } from 'node:url'

import { createServerApiServer } from './api/app'
import { createServerApiContext } from './api/context'
import { readServerEnv } from './env'
import { createServerConsumerNotFoundHandler } from './runtime/not-found'
import { loadNuxtNodeListener } from './runtime/nuxt-listener'
import { startServerStorage } from './storage/repo'

export async function startServerConsumer(): Promise<boolean> {
	const env = readServerEnv()
	const serverStorage = await startServerStorage({ dataDir: env.GORCHESTRA_DATA_DIR })
	const context = createServerApiContext({ serverStorage, env })
	const nuxtListener = await loadNuxtNodeListener()
	const server = createServerApiServer(context, env)
	server.setNotFoundHandler(createServerConsumerNotFoundHandler(nuxtListener))
	return server.start()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await startServerConsumer()
}
