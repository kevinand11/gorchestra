import { Instance } from 'equipped'

import { createServerApiServer } from './api/app'
import { createServerApiContext } from './api/context'
import { resetStartedServerCache, startServerCache } from './cache'
import {
	coreDispatchProcessorConfigPipe,
	defaultPortfolioCoreSupervisionConfig,
	portfolioCoreSupervisionConfigPipe,
	serverConsumerConfigPipe,
	type PortfolioCoreSupervisionConfig,
	type ServerConsumerCacheConfig,
	type ServerConsumerConfig,
	type ServerConsumerCoreDispatchProcessorConfig,
	type ServerConsumerCorePortfolioStorageConfig,
	type ServerConsumerJsonStorageConfig,
	type ServerConsumerServerStorageConfig,
	validateServerConsumerConfig,
} from './config'
import { createPortfolioCoreSupervision, type PortfolioCoreSupervision } from './core/portfolio-supervision'
import { ensureServerInstance } from './instance'
import { createDeferredServerConsumerNotFoundHandler, createServerConsumerNotFoundHandler } from './runtime/not-found'
import { buildNuxtProductionRuntime } from './runtime/nuxt-build'
import { createNuxtDevRuntime, type NuxtDevRuntime } from './runtime/nuxt-dev'
import { loadNuxtNodeListener } from './runtime/nuxt-listener'
import { migrateServerStorage, resetStartedServerStorage, startServerStorage } from './storage/repo'
export { parseSecretEncryptionKey, type SecretEncryptionKey } from './modules/secret-protection'
export {
	coreDispatchProcessorConfigPipe,
	defaultPortfolioCoreSupervisionConfig,
	portfolioCoreSupervisionConfigPipe,
	serverConsumerConfigPipe,
	validateServerConsumerConfig,
	type PortfolioCoreSupervisionConfig,
	type ServerConsumerCacheConfig,
	type ServerConsumerConfig,
	type ServerConsumerCoreDispatchProcessorConfig,
	type ServerConsumerCorePortfolioStorageConfig,
	type ServerConsumerJsonStorageConfig,
	type ServerConsumerServerStorageConfig,
}

export type StartServerConsumerOptions = {
	dev?: boolean
}

export type ServerConsumer = ReturnType<typeof createServerConsumer>

class ServerConsumerShutdown {}

export function createServerConsumer(input: ServerConsumerConfig) {
	const config = validateServerConsumerConfig(input)
	let started = false
	let closed = false
	let closePromise: Promise<void> | null = null
	let portfolioCores: PortfolioCoreSupervision | null = null
	let closeIngress: (() => Promise<void>) | null = null
	let runtimeShutdownPromise: Promise<void> | null = null

	function stopIngress(): Promise<void> {
		return closeIngress?.() ?? Promise.resolve()
	}

	function shutdownRuntime(): Promise<void> {
		runtimeShutdownPromise ??= drainServerConsumerRuntime({
			stopIngress,
			closePortfolioCores: () => portfolioCores?.close() ?? Promise.resolve(),
		})
		return runtimeShutdownPromise
	}

	async function start(options: StartServerConsumerOptions = {}): Promise<void> {
		if (started) throw new Error('Server Consumer has already been started.')
		if (closed) throw new Error('Server Consumer has already been closed.')
		started = true

		try {
			const instance = ensureServerInstance()
			const serverCache = await startConfiguredServerCache(config.cache)
			const serverStorage = await startConfiguredServerStorage(config.serverStorage)
			portfolioCores = createPortfolioCoreSupervision({
				serverStorage,
				corePortfolioStorage: config.corePortfolioStorage,
				secretEncryptionKey: config.security.secretEncryptionKey,
				config: config.portfolioCoreSupervision,
				processor: config.coreDispatchProcessor,
				publishNotification: ({ portfolioId, notification }) => {
					globalThis.console.log('Core notification', { portfolioId, notification })
				},
				log: {
					warn: (message, context) => globalThis.console.warn(message, context),
				},
			})
			const context = createServerApiContext({
				serverStorage,
				serverCache,
				corePortfolioStorage: config.corePortfolioStorage,
				security: config.security,
				portfolioCores,
			})
			const server = createServerApiServer(context, config.http.port)
			closeIngress = async () => await server.socket.socketInstance.close()

			Instance.on('close', shutdownRuntime, {
				class: ServerConsumerShutdown,
				after: [serverStorage.adapter.constructor, serverCache.adapter.constructor],
			})

			if (options.dev === true) {
				let nuxtRuntime: NuxtDevRuntime | null = null
				server.setNotFoundHandler(createDeferredServerConsumerNotFoundHandler(() => nuxtRuntime?.listener ?? null))
				server.onBeforeListen(async ({ httpServer, port }) => {
					nuxtRuntime = await createNuxtDevRuntime({ httpServer, port })
					Instance.on('close', async () => await nuxtRuntime?.close())
				})
			}

			await runServerConsumerStartup({
				startInfrastructure: () => instance.start(),
				migrateRegistry: () => migrateServerStorage(serverStorage),
				startPortfolioCores: () => portfolioCores?.start() ?? Promise.resolve(),
				listen: async () => {
					if (options.dev !== true) {
						await buildNuxtProductionRuntime()
						const nuxtListener = await loadNuxtNodeListener()
						server.setNotFoundHandler(createServerConsumerNotFoundHandler(nuxtListener))
					}
					await server.start()
				},
			})
		} catch (error) {
			await closeServerConsumer().catch(() => {})
			throw error
		}
	}

	async function close(): Promise<void> {
		closePromise ??= closeServerConsumer()
		return closePromise
	}

	async function closeServerConsumer(): Promise<void> {
		let failure: Error | undefined
		try {
			await shutdownRuntime()
		} catch (error) {
			failure = errorFromUnknown(error, 'Server runtime shutdown failed')
		}
		try {
			const instance = Instance.maybeGet()
			if (instance !== undefined) await instance.close()
		} catch (error) {
			failure ??= errorFromUnknown(error, 'Server infrastructure shutdown failed')
		} finally {
			resetStartedServerStorage()
			resetStartedServerCache()
			closed = true
		}
		if (failure !== undefined) throw failure
	}

	return { start, close }
}

async function drainServerConsumerRuntime(input: {
	stopIngress: () => Promise<void>
	closePortfolioCores: () => Promise<void>
}): Promise<void> {
	const ingressStopped = input.stopIngress()
	const portfolioCoresClosed = input.closePortfolioCores()
	const results = await Promise.allSettled([ingressStopped, portfolioCoresClosed])
	const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
	if (failure !== undefined) throw errorFromUnknown(failure.reason, 'Server runtime shutdown failed')
}

function errorFromUnknown(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback)
}

async function runServerConsumerStartup(input: {
	startInfrastructure: () => Promise<void>
	migrateRegistry: () => Promise<void>
	startPortfolioCores: () => Promise<void>
	listen: () => Promise<void>
}): Promise<void> {
	await input.startInfrastructure()
	await input.migrateRegistry()
	await input.startPortfolioCores()
	await input.listen()
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
	const { describe, expect, it, vi } = import.meta.vitest

	describe('Server Consumer startup API', () => {
		it('starts infrastructure, migrates the registry, starts Portfolio Core Supervision, then listens', async () => {
			const calls: string[] = []
			await runServerConsumerStartup({
				startInfrastructure: vi.fn(() => {
					calls.push('instance-start')
					return Promise.resolve()
				}),
				migrateRegistry: vi.fn(() => {
					calls.push('server-storage-migrate')
					return Promise.resolve()
				}),
				startPortfolioCores: vi.fn(() => {
					calls.push('portfolio-supervision-start')
					return Promise.resolve()
				}),
				listen: vi.fn(() => {
					calls.push('http-listen')
					return Promise.resolve()
				}),
			})

			expect(calls).toEqual(['instance-start', 'server-storage-migrate', 'portfolio-supervision-start', 'http-listen'])
		})

		it('initiates ingress stop before draining Portfolio Core runtimes', async () => {
			const calls: string[] = []
			let resolveIngress: (() => void) | undefined
			let resolvePortfolioCores: (() => void) | undefined
			const shutdown = drainServerConsumerRuntime({
				stopIngress: () => {
					calls.push('stop-ingress')
					return new Promise<void>((resolve) => {
						resolveIngress = resolve
					})
				},
				closePortfolioCores: () => {
					calls.push('drain-portfolio-cores')
					return new Promise<void>((resolve) => {
						resolvePortfolioCores = resolve
					})
				},
			})

			expect(calls).toEqual(['stop-ingress', 'drain-portfolio-cores'])
			resolveIngress?.()
			resolvePortfolioCores?.()
			await shutdown
		})

		it('waits for Portfolio Core drain before propagating an ingress shutdown failure', async () => {
			let resolvePortfolioCores: (() => void) | undefined
			const shutdown = drainServerConsumerRuntime({
				stopIngress: () => Promise.reject(new Error('ingress close failed')),
				closePortfolioCores: () =>
					new Promise<void>((resolve) => {
						resolvePortfolioCores = resolve
					}),
			})
			const earlyOutcome = await Promise.race([
				shutdown.then(
					() => 'fulfilled',
					() => 'rejected',
				),
				new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 0)),
			])

			expect(earlyOutcome).toBe('pending')
			resolvePortfolioCores?.()
			await expect(shutdown).rejects.toThrow('ingress close failed')
		})

		it('does not listen when the initial Portfolio Registry scan fails', async () => {
			const listen = vi.fn(() => Promise.resolve())

			await expect(
				runServerConsumerStartup({
					startInfrastructure: () => Promise.resolve(),
					migrateRegistry: () => Promise.resolve(),
					startPortfolioCores: () => Promise.reject(new Error('Portfolio Registry scan failed')),
					listen,
				}),
			).rejects.toThrow('Portfolio Registry scan failed')
			expect(listen).not.toHaveBeenCalled()
		})

		it('validates startup config when creating a Server Consumer', () => {
			expect(() => createServerConsumer({ ...validConfig(), http: { port: '3000' as never } })).toThrow(
				'Server Consumer Config is not valid',
			)
		})
	})

	function validConfig(): ServerConsumerConfig {
		return validateServerConsumerConfig({
			http: { port: 0 },
			serverStorage: { type: 'json', dataDir: '/tmp/gorchestra-test' },
			corePortfolioStorage: { type: 'json', dataDir: '/tmp/gorchestra-test' },
			cache: { type: 'json', dataDir: '/tmp/gorchestra-test' },
			security: {
				sessionSigningKey: 'session-key',
				selectionSigningKey: 'selection-key',
				secretEncryptionKey: Buffer.alloc(32, 1),
			},
		} as ServerConsumerConfig)
	}
}
