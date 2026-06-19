import { pathToFileURL } from 'node:url'

import { readServerEnv } from '../env'
import { createServerApiServer } from './app'
import { createServerApiContext } from './context'
import { startServerStorage } from '../storage/repo'

export async function startServerApi(): Promise<boolean> {
	const env = readServerEnv()
	const serverStorage = await startServerStorage({ dataDir: env.GORCHESTRA_DATA_DIR })
	const context = createServerApiContext({ serverStorage, env })
	const server = createServerApiServer(context, env)
	return server.start()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await startServerApi()
}
