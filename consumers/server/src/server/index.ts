import { Instance } from 'equipped'

import { createServerApiServer } from './api/app'
import { createServerApiContext } from './api/context'
import { resetStartedServerCache, startServerCache } from './cache'
import {
	serverConsumerConfigPipe,
	type ServerConsumerCacheConfig,
	type ServerConsumerConfig,
	type ServerConsumerCorePortfolioStorageConfig,
	type ServerConsumerJsonStorageConfig,
	type ServerConsumerServerStorageConfig,
	validateServerConsumerConfig,
} from './config'
import { ensureServerInstance } from './instance'
import { createDeferredServerConsumerNotFoundHandler, createServerConsumerNotFoundHandler } from './runtime/not-found'
import { buildNuxtProductionRuntime } from './runtime/nuxt-build'
import { createNuxtDevRuntime, type NuxtDevRuntime } from './runtime/nuxt-dev'
import { loadNuxtNodeListener } from './runtime/nuxt-listener'
import { migrateServerStorage, resetStartedServerStorage, startServerStorage } from './storage/repo'
export { parseSecretEncryptionKey, type SecretEncryptionKey } from './modules/secret-protection'
export {
	serverConsumerConfigPipe,
	type ServerConsumerCacheConfig,
	type ServerConsumerConfig,
	type ServerConsumerCorePortfolioStorageConfig,
	type ServerConsumerJsonStorageConfig,
	type ServerConsumerServerStorageConfig,
}

export type StartServerConsumerOptions = {
	dev?: boolean
}

export type ServerConsumer = ReturnType<typeof createServerConsumer>

export function createServerConsumer(input: ServerConsumerConfig) {
	const config = validateServerConsumerConfig(input)
	let started = false
	let closed = false
	let closePromise: Promise<void> | null = null

	async function start(options: StartServerConsumerOptions = {}): Promise<void> {
		if (started) throw new Error('Server Consumer has already been started.')
		if (closed) throw new Error('Server Consumer has already been closed.')
		started = true

		const instance = ensureServerInstance()
		const serverCache = await startConfiguredServerCache(config.cache)
		const serverStorage = await startConfiguredServerStorage(config.serverStorage)
		const context = createServerApiContext({
			serverStorage,
			serverCache,
			corePortfolioStorage: config.corePortfolioStorage,
			security: config.security,
		})
		const server = createServerApiServer(context, config.http.port)

		if (options.dev === true) {
			let nuxtRuntime: NuxtDevRuntime | null = null
			server.setNotFoundHandler(createDeferredServerConsumerNotFoundHandler(() => nuxtRuntime?.listener ?? null))
			server.onBeforeListen(async ({ httpServer, port }) => {
				nuxtRuntime = await createNuxtDevRuntime({ httpServer, port })
				Instance.on('close', async () => await nuxtRuntime?.close())
			})
		}

		await instance.start()
		await migrateServerStorage(serverStorage)
		if (options.dev !== true) {
			await buildNuxtProductionRuntime()
			const nuxtListener = await loadNuxtNodeListener()
			server.setNotFoundHandler(createServerConsumerNotFoundHandler(nuxtListener))
		}
		await server.start()
	}

	async function close(): Promise<void> {
		closePromise ??= closeServerConsumer()
		return closePromise
	}

	async function closeServerConsumer(): Promise<void> {
		const instance = Instance.maybeGet()
		if (instance !== undefined) await instance.close()
		resetStartedServerStorage()
		resetStartedServerCache()
		closed = true
	}

	return { start, close }
}

function startConfiguredServerStorage(config: ServerConsumerServerStorageConfig) {
	switch (config.type) {
		case 'json':
			return startServerStorage({ dataDir: config.dataDir })
		default:
			throw new Error(`Unexpected Server storage config: ${JSON.stringify(config)}`)
	}
}

function startConfiguredServerCache(config: ServerConsumerCacheConfig) {
	switch (config.type) {
		case 'json':
			return startServerCache({ dataDir: config.dataDir })
		default:
			throw new Error(`Unexpected Server cache config: ${JSON.stringify(config)}`)
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server Consumer startup API', () => {
		it('validates startup config when creating a Server Consumer', () => {
			expect(() => createServerConsumer({ ...validConfig(), http: { port: '3000' as never } })).toThrow(
				'Server Consumer Config is not valid',
			)
		})
	})

	function validConfig(): ServerConsumerConfig {
		return {
			http: { port: 0 },
			serverStorage: { type: 'json', dataDir: '/tmp/gorchestra-test' },
			corePortfolioStorage: { type: 'json', dataDir: '/tmp/gorchestra-test' },
			cache: { type: 'json', dataDir: '/tmp/gorchestra-test' },
			security: {
				sessionSigningKey: 'session-key',
				selectionSigningKey: 'selection-key',
				secretEncryptionKey: Buffer.alloc(32, 1),
			},
		}
	}
}
