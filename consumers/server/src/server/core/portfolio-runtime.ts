import {
	defaultDispatchProcessorOptions,
	openCore,
	type CoreDispatchProcessorHandle,
	type CoreServices,
	type GorchestraCore,
	type Result,
} from '@gorchestra/core'

import { createCoreServices, type CreateCoreServicesOptions } from './services'
import { openCorePortfolioStorage } from './storage'
import type { ServerConsumerCoreDispatchProcessorConfig, ServerConsumerCorePortfolioStorageConfig } from '../config'
import type { SecretEncryptionKey } from '../modules/secret-protection'
import type { PortfolioRegistryEntry } from '../storage/schemas'

export type PortfolioCoreRuntime = {
	portfolioId: string
	coreStorageNamespace: string
	core: GorchestraCore
	readonly processor: CoreDispatchProcessorHandle
	replaceProcessor: (handle: CoreDispatchProcessorHandle) => void
	stopProcessor: () => Promise<void>
	closeStorage: () => Promise<void>
}

export type PortfolioCoreRuntimeStartFailureReason =
	| 'storage-open-failed'
	| 'core-open-failed'
	| 'core-preflight-failed'
	| 'processor-start-failed'
	| 'processor-ready-failed'

export type PortfolioCoreRuntimeStartFailure = {
	type: 'portfolio-core-runtime-start-failed'
	reason: PortfolioCoreRuntimeStartFailureReason
}

export type OpenPortfolioCoreRuntimeInput = {
	portfolio: PortfolioRegistryEntry
	corePortfolioStorage: ServerConsumerCorePortfolioStorageConfig
	secretEncryptionKey: SecretEncryptionKey
	processor: ServerConsumerCoreDispatchProcessorConfig
	publishNotification(input: {
		portfolioId: string
		notification: Parameters<NonNullable<CoreServices['notifications']>['publish']>[0]
	}): void
}

type PortfolioRuntimeDependencies = {
	openStorage: typeof openCorePortfolioStorage
	open: typeof openCore
	createServices: typeof createCoreServices
}

const portfolioRuntimeDependencies: PortfolioRuntimeDependencies = {
	openStorage: openCorePortfolioStorage,
	open: openCore,
	createServices: createCoreServices,
}

export async function openPortfolioCoreRuntime(
	input: OpenPortfolioCoreRuntimeInput,
): Promise<Result<PortfolioCoreRuntime, PortfolioCoreRuntimeStartFailure>> {
	return openPortfolioCoreRuntimeWith(input, portfolioRuntimeDependencies)
}

async function openPortfolioCoreRuntimeWith(
	input: OpenPortfolioCoreRuntimeInput,
	dependencies: PortfolioRuntimeDependencies,
): Promise<Result<PortfolioCoreRuntime, PortfolioCoreRuntimeStartFailure>> {
	let coreStorage: Awaited<ReturnType<typeof openCorePortfolioStorage>>
	try {
		coreStorage = await dependencies.openStorage({
			config: input.corePortfolioStorage,
			coreStorageNamespace: input.portfolio.coreStorageNamespace,
		})
	} catch {
		return startFailure('storage-open-failed')
	}

	let processor: CoreDispatchProcessorHandle | undefined
	async function fail(reason: PortfolioCoreRuntimeStartFailureReason) {
		if (processor !== undefined) await processor.stop().catch(() => {})
		await coreStorage.close().catch(() => {})
		return startFailure(reason)
	}

	let core: GorchestraCore
	try {
		const opened = dependencies.open(
			dependencies.createServices(coreStorage.storage, {
				secretEncryptionKey: input.secretEncryptionKey,
				sandboxRootDir: input.corePortfolioStorage.dataDir,
				coreStorageNamespace: input.portfolio.coreStorageNamespace,
				dispatchWake: createDispatchWake(),
				notifications: {
					publish: (notification) => input.publishNotification({ portfolioId: input.portfolio.id, notification }),
				},
			}),
		)
		if (!opened.ok) return await fail('core-open-failed')
		core = opened.value
	} catch {
		return await fail('core-open-failed')
	}

	try {
		const preflight = await core.preflight()
		if (!preflight.ok || !preflight.value.passed) return await fail('core-preflight-failed')
	} catch {
		return await fail('core-preflight-failed')
	}

	try {
		const started = core.dispatch.startProcessor(input.processor)
		if (!started.ok) return await fail('processor-start-failed')
		processor = started.value
	} catch {
		return await fail('processor-start-failed')
	}

	try {
		const ready = await processor.ready
		if (!ready.ok) return await fail('processor-ready-failed')
	} catch {
		return await fail('processor-ready-failed')
	}

	let currentProcessor = processor
	const stoppedProcessors = new WeakSet<CoreDispatchProcessorHandle>()
	let closeStoragePromise: Promise<void> | undefined
	return {
		ok: true,
		value: {
			portfolioId: input.portfolio.id,
			coreStorageNamespace: input.portfolio.coreStorageNamespace,
			core,
			get processor() {
				return currentProcessor
			},
			replaceProcessor(handle) {
				currentProcessor = handle
			},
			async stopProcessor() {
				const handle = currentProcessor
				if (stoppedProcessors.has(handle)) return
				stoppedProcessors.add(handle)
				await handle.stop()
			},
			closeStorage() {
				closeStoragePromise ??= coreStorage.close()
				return closeStoragePromise
			},
		},
	}
}

function createDispatchWake(): NonNullable<CoreServices['dispatchWake']> {
	const listeners = new Set<() => void>()
	return {
		publish() {
			for (const listener of [...listeners]) {
				try {
					listener()
				} catch {
					// Core Dispatch Wake is best-effort; polling remains authoritative.
				}
			}
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	}
}

function startFailure(reason: PortfolioCoreRuntimeStartFailureReason): Result<never, PortfolioCoreRuntimeStartFailure> {
	return { ok: false, error: { type: 'portfolio-core-runtime-start-failed', reason } }
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it, vi } = import.meta.vitest
	const { mkdtemp, rm } = await import('node:fs/promises')
	const { tmpdir } = await import('node:os')
	const { join } = await import('node:path')

	let tempDataDirs: string[] = []

	afterEach(async () => {
		await Promise.all(tempDataDirs.map((path) => rm(path, { recursive: true, force: true })))
		tempDataDirs = []
	})

	describe('Portfolio Core Runtime', () => {
		it('delivers payload-free Dispatch Wakes without retaining or coupling listeners', () => {
			const wake = createDispatchWake()
			const failedListener = vi.fn(() => {
				throw new Error('listener failed')
			})
			const healthyListener = vi.fn()
			wake.publish()
			const unsubscribeFailed = wake.subscribe(failedListener)
			const unsubscribeHealthy = wake.subscribe(healthyListener)

			expect(failedListener).not.toHaveBeenCalled()
			expect(healthyListener).not.toHaveBeenCalled()
			wake.publish()
			expect(failedListener).toHaveBeenCalledOnce()
			expect(healthyListener).toHaveBeenCalledOnce()

			unsubscribeFailed()
			unsubscribeFailed()
			unsubscribeHealthy()
			wake.publish()
			expect(healthyListener).toHaveBeenCalledOnce()
		})

		it('publishes Core Notifications with the owning Portfolio id', async () => {
			const publishNotification = vi.fn()
			const processor = testProcessorHandle()
			let serviceOptions: CreateCoreServicesOptions | undefined
			const result = await openPortfolioCoreRuntimeWith(
				{
					portfolio: testPortfolio(),
					corePortfolioStorage: { type: 'json', dataDir: '/tmp/gorchestra' },
					secretEncryptionKey: Buffer.alloc(32, 1),
					processor: { ...defaultDispatchProcessorOptions },
					publishNotification,
				},
				{
					openStorage: vi.fn().mockResolvedValue({ storage: {}, close: vi.fn(), adapter: {} }),
					createServices: vi.fn((_storage: CoreServices['storage'], options: CreateCoreServicesOptions) => {
						serviceOptions = options
						return {} as CoreServices
					}),
					open: vi.fn(() => ({ ok: true, value: testCore(processor) })),
				} as unknown as PortfolioRuntimeDependencies,
			)
			expect(result.ok).toBe(true)
			if (!result.ok || serviceOptions?.notifications === undefined) return
			const notification = {
				id: '01k00000000000000000000003',
				data: {
					type: 'assistant-message-draft-updated' as const,
					agentRunId: '01k00000000000000000000004',
					turnStartedEventId: '01k00000000000000000000005',
					draftId: 'draft-1',
					delta: { type: 'model-output-started' as const },
				},
			}

			serviceOptions.notifications.publish(notification)

			expect(publishNotification).toHaveBeenCalledWith({ portfolioId: testPortfolio().id, notification })
		})

		it('discards the processor and storage when initial processor readiness fails', async () => {
			const closeStorage = vi.fn(() => Promise.resolve())
			const stopProcessor = vi.fn(() => Promise.resolve())
			const processor = {
				...testProcessorHandle(),
				stop: stopProcessor,
				ready: Promise.resolve({ ok: false as const, error: {} as never }),
			}
			const result = await openPortfolioCoreRuntimeWith(
				{
					portfolio: testPortfolio(),
					corePortfolioStorage: { type: 'json', dataDir: '/tmp/gorchestra' },
					secretEncryptionKey: Buffer.alloc(32, 1),
					processor: { ...defaultDispatchProcessorOptions },
					publishNotification: vi.fn(),
				},
				{
					openStorage: vi.fn().mockResolvedValue({ storage: {}, close: closeStorage, adapter: {} }),
					createServices: vi.fn(() => ({}) as CoreServices),
					open: vi.fn(() => ({ ok: true, value: testCore(processor) })),
				} as unknown as PortfolioRuntimeDependencies,
			)

			expect(result).toEqual({
				ok: false,
				error: { type: 'portfolio-core-runtime-start-failed', reason: 'processor-ready-failed' },
			})
			expect(stopProcessor).toHaveBeenCalledOnce()
			expect(closeStorage).toHaveBeenCalledOnce()
		})

		it('opens an initialized Core and waits for the Dispatch Processor to become ready', async () => {
			const dataDir = await mkdtemp(join(tmpdir(), 'gorchestra-portfolio-runtime-'))
			tempDataDirs.push(dataDir)
			const result = await openPortfolioCoreRuntime({
				portfolio: {
					id: '01k00000000000000000000001',
					workspaceId: '01k00000000000000000000002',
					displayName: 'Portfolio',
					coreStorageNamespace: 'portfolios/runtime-test',
					registeredAt: '2026-07-14T00:00:00.000Z',
				},
				corePortfolioStorage: { type: 'json', dataDir },
				secretEncryptionKey: Buffer.alloc(32, 1),
				processor: { ...defaultDispatchProcessorOptions },
				publishNotification: vi.fn(),
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return
			expect(result.value.portfolioId).toBe('01k00000000000000000000001')
			expect(result.value.processor.status()).toEqual({ type: 'running', activeAttempts: 0 })

			await result.value.stopProcessor()
			await result.value.closeStorage()
		})
	})

	function testPortfolio(): PortfolioRegistryEntry {
		return {
			id: '01k00000000000000000000001',
			workspaceId: '01k00000000000000000000002',
			displayName: 'Portfolio',
			coreStorageNamespace: 'portfolios/runtime-test',
			registeredAt: '2026-07-14T00:00:00.000Z',
		}
	}

	function testProcessorHandle(): CoreDispatchProcessorHandle {
		return {
			status: () => ({ type: 'running', activeAttempts: 0 }),
			stop: vi.fn(() => Promise.resolve()),
			ready: Promise.resolve({ ok: true, value: undefined }),
			completed: new Promise(() => {}),
		}
	}

	function testCore(processor: CoreDispatchProcessorHandle): GorchestraCore {
		return {
			preflight: () =>
				Promise.resolve({ ok: true, value: { passed: true, checks: { storage: { ok: true }, secrets: { ok: true } } } }),
			dispatch: { startProcessor: () => ({ ok: true, value: processor }) },
		} as GorchestraCore
	}
}
