import type { GorchestraCore, Result } from '@gorchestra/core'

import { openPortfolioCoreRuntime, type PortfolioCoreRuntime } from './portfolio-runtime'
import type {
	PortfolioCoreSupervisionConfig,
	ServerConsumerCoreDispatchProcessorConfig,
	ServerConsumerCorePortfolioStorageConfig,
} from '../config'
import type { SecretEncryptionKey } from '../modules/secret-protection'
import { findPortfolioRegistryEntry, listPortfolioRegistryEntries } from '../modules/workspaces'
import type { ServerStorage } from '../storage/repo'
import type { PortfolioRegistryEntry } from '../storage/schemas'

export type PortfolioCoreBorrowError = { type: 'portfolio-core-unavailable' }

export interface PortfolioCoreSupervision {
	start: () => Promise<void>
	portfolioRegistered: (portfolioId: string) => void
	borrow: <T>(portfolioId: string, run: (core: GorchestraCore) => Promise<T>) => Promise<Result<T, PortfolioCoreBorrowError>>
	close: () => Promise<void>
}

type PortfolioCoreSupervisionLog = {
	warn: (message: string, context: Record<string, unknown>) => void
}

export type CreatePortfolioCoreSupervisionInput = {
	serverStorage: ServerStorage
	corePortfolioStorage: ServerConsumerCorePortfolioStorageConfig
	secretEncryptionKey: SecretEncryptionKey
	config: PortfolioCoreSupervisionConfig
	processor: ServerConsumerCoreDispatchProcessorConfig
	publishNotification: Parameters<typeof openPortfolioCoreRuntime>[0]['publishNotification']
	log?: PortfolioCoreSupervisionLog
}

type PortfolioCoreSupervisionDependencies = {
	listPortfolios(serverStorage: ServerStorage): Promise<PortfolioRegistryEntry[]>
	findPortfolio(serverStorage: ServerStorage, portfolioId: string): Promise<PortfolioRegistryEntry | null>
	openRuntime: typeof openPortfolioCoreRuntime
	random(): number
}

const portfolioCoreSupervisionDependencies: PortfolioCoreSupervisionDependencies = {
	listPortfolios: (serverStorage) => listPortfolioRegistryEntries({ serverStorage }),
	findPortfolio: (serverStorage, portfolioId) => findPortfolioRegistryEntry({ serverStorage, portfolioId }),
	openRuntime: openPortfolioCoreRuntime,
	random: Math.random,
}

export function createPortfolioCoreSupervision(input: CreatePortfolioCoreSupervisionInput): PortfolioCoreSupervision {
	return createPortfolioCoreSupervisionWith(input, portfolioCoreSupervisionDependencies)
}

function createPortfolioCoreSupervisionWith(
	input: CreatePortfolioCoreSupervisionInput,
	dependencies: PortfolioCoreSupervisionDependencies,
): PortfolioCoreSupervision {
	type RuntimeState = {
		portfolio: PortfolioRegistryEntry
		phase: 'starting' | 'ready' | 'degraded' | 'stopping'
		runtime?: PortfolioCoreRuntime
		generation: number
		runtimeRetryAttempt: number
		runtimeRetryTimer: ReturnType<typeof setTimeout> | undefined
		processorGeneration: number
		processorRetryAttempt: number
		processorRetryTimer: ReturnType<typeof setTimeout> | undefined
		processorRestarting: boolean
		processorCandidate: PortfolioCoreRuntime['processor'] | undefined
		activeBorrows: number
		borrowDrainWaiters: Set<() => void>
	}

	const states = new Map<string, RuntimeState>()
	const log = input.log ?? { warn: () => {} }
	const pendingRegistrationSignals = new Set<string>()
	const startSlotQueue: Array<() => void> = []
	let activeStarts = 0
	let initializing = true
	let closed = false
	let reconciliationTimer: ReturnType<typeof setTimeout> | undefined
	let startPromise: Promise<void> | undefined
	let closePromise: Promise<void> | undefined

	async function acquireStartSlot(): Promise<void> {
		if (activeStarts < input.config.maxConcurrentStarts) {
			activeStarts += 1
			return
		}
		await new Promise<void>((resolve) => {
			startSlotQueue.push(() => {
				activeStarts += 1
				resolve()
			})
		})
	}

	function releaseStartSlot(): void {
		activeStarts -= 1
		startSlotQueue.shift()?.()
	}

	function retryDelay(attempt: number): number {
		const baseDelay = Math.min(input.config.retryMaxDelayMs, input.config.retryInitialDelayMs * input.config.retryMultiplier ** attempt)
		const jitter = (dependencies.random() * 2 - 1) * input.config.retryJitterRatio
		return Math.round(baseDelay * (1 + jitter))
	}

	function scheduleRuntimeRetry(state: RuntimeState): void {
		if (closed || state.phase !== 'degraded' || state.runtimeRetryTimer !== undefined) return
		const delay = retryDelay(state.runtimeRetryAttempt)
		state.runtimeRetryAttempt += 1
		state.runtimeRetryTimer = setTimeout(() => {
			state.runtimeRetryTimer = undefined
			void startRuntime(state.portfolio)
		}, delay)
	}

	function monitorProcessor(state: RuntimeState, runtime: PortfolioCoreRuntime, processor: PortfolioCoreRuntime['processor']): void {
		state.processorGeneration += 1
		const processorGeneration = state.processorGeneration
		void processor.completed
			.then((result) => ({ status: result.ok ? 'stopped' : 'failed' }))
			.catch(() => ({ status: 'failed' as const }))
			.then(({ status }) => {
				if (closed || state.phase !== 'ready' || state.runtime !== runtime || state.processorGeneration !== processorGeneration) {
					return
				}
				log.warn('Portfolio Core Dispatch Processor stopped; scheduling restart.', { portfolioId: state.portfolio.id, status })
				scheduleProcessorRetry(state)
			})
	}

	function scheduleProcessorRetry(state: RuntimeState): void {
		if (
			closed ||
			state.phase !== 'ready' ||
			state.runtime === undefined ||
			state.processorRetryTimer !== undefined ||
			state.processorRestarting
		) {
			return
		}
		const delay = retryDelay(state.processorRetryAttempt)
		state.processorRetryAttempt += 1
		state.processorRetryTimer = setTimeout(() => {
			state.processorRetryTimer = undefined
			void restartProcessor(state)
		}, delay)
	}

	function processorRestartIsCurrent(state: RuntimeState, runtime: PortfolioCoreRuntime): boolean {
		return !closed && state.phase === 'ready' && state.runtime === runtime
	}

	async function waitForProcessorReadiness(
		processor: PortfolioCoreRuntime['processor'],
	): Promise<{ ready: true } | { ready: false; reason: string }> {
		let readinessTimeout: ReturnType<typeof setTimeout> | undefined
		const readiness = await Promise.race([
			processor.ready.then((result) => ({ type: 'completed' as const, result })).catch(() => ({ type: 'failed' as const })),
			new Promise<{ type: 'timed-out' }>((resolve) => {
				readinessTimeout = setTimeout(() => resolve({ type: 'timed-out' }), input.config.runtimeStartTimeoutMs)
			}),
		])
		if (readinessTimeout !== undefined) clearTimeout(readinessTimeout)
		if (readiness.type !== 'completed') return { ready: false, reason: readiness.type }
		if (!readiness.result.ok) return { ready: false, reason: readiness.result.error.type }
		return { ready: true }
	}

	async function restartProcessor(state: RuntimeState): Promise<void> {
		const runtime = state.runtime
		if (runtime === undefined || !processorRestartIsCurrent(state, runtime) || state.processorRestarting) return
		state.processorRestarting = true
		let processor: PortfolioCoreRuntime['processor'] | undefined
		let restarted = false
		try {
			const started = runtime.core.dispatch.startProcessor(input.processor)
			if (!started.ok) {
				log.warn('Portfolio Core Dispatch Processor restart failed.', {
					portfolioId: state.portfolio.id,
					reason: started.error.type,
				})
				return
			}
			processor = started.value
			state.processorCandidate = processor
			const readiness = await waitForProcessorReadiness(processor)
			if (!readiness.ready || !processorRestartIsCurrent(state, runtime)) {
				log.warn('Portfolio Core Dispatch Processor did not become ready.', {
					portfolioId: state.portfolio.id,
					reason: readiness.ready ? 'generation-closed' : readiness.reason,
				})
				return
			}
			runtime.replaceProcessor(processor)
			state.processorRetryAttempt = 0
			restarted = true
			monitorProcessor(state, runtime, processor)
		} catch {
			log.warn('Portfolio Core Dispatch Processor restart failed.', {
				portfolioId: state.portfolio.id,
				reason: 'unexpected-failure',
			})
		} finally {
			if (processor !== undefined && !restarted) await processor.stop().catch(() => {})
			if (state.processorCandidate === processor) state.processorCandidate = undefined
			state.processorRestarting = false
			if (!restarted) scheduleProcessorRetry(state)
		}
	}

	async function disposeRuntime(runtime: PortfolioCoreRuntime): Promise<void> {
		await runtime.stopProcessor().catch(() => {})
		await runtime.closeStorage().catch(() => {})
	}

	async function startRuntime(portfolio: PortfolioRegistryEntry): Promise<void> {
		const state: RuntimeState = states.get(portfolio.id) ?? {
			portfolio,
			phase: 'starting',
			generation: 0,
			runtimeRetryAttempt: 0,
			runtimeRetryTimer: undefined,
			processorGeneration: 0,
			processorRetryAttempt: 0,
			processorRetryTimer: undefined,
			processorRestarting: false,
			processorCandidate: undefined,
			activeBorrows: 0,
			borrowDrainWaiters: new Set(),
		}
		state.portfolio = portfolio
		state.phase = 'starting'
		state.generation += 1
		const generation = state.generation
		states.set(portfolio.id, state)
		await acquireStartSlot()
		if (closed) {
			state.phase = 'stopping'
			releaseStartSlot()
			return
		}
		try {
			const openedPromise = dependencies
				.openRuntime({
					portfolio,
					corePortfolioStorage: input.corePortfolioStorage,
					secretEncryptionKey: input.secretEncryptionKey,
					processor: input.processor,
					publishNotification: input.publishNotification,
				})
				.then((result) => ({ type: 'completed' as const, result }))
				.catch(() => ({ type: 'failed' as const }))
			let timeout: ReturnType<typeof setTimeout> | undefined
			const outcome = await Promise.race([
				openedPromise,
				new Promise<{ type: 'timed-out' }>((resolve) => {
					timeout = setTimeout(() => resolve({ type: 'timed-out' }), input.config.runtimeStartTimeoutMs)
				}),
			])
			if (timeout !== undefined) clearTimeout(timeout)

			if (outcome.type === 'timed-out') {
				if (state.generation === generation) state.phase = 'degraded'
				log.warn('Portfolio Core Runtime start timed out.', { portfolioId: portfolio.id })
				void openedPromise.then(async (lateOutcome) => {
					if (lateOutcome.type === 'completed' && lateOutcome.result.ok) await disposeRuntime(lateOutcome.result.value)
				})
				return
			}
			if (outcome.type === 'failed') {
				if (state.generation === generation) state.phase = 'degraded'
				log.warn('Portfolio Core Runtime start failed.', { portfolioId: portfolio.id, reason: 'unexpected-failure' })
				return
			}
			if (!outcome.result.ok) {
				if (state.generation === generation) state.phase = 'degraded'
				log.warn('Portfolio Core Runtime start failed.', { portfolioId: portfolio.id, reason: outcome.result.error.reason })
				return
			}
			if (state.generation !== generation) {
				await disposeRuntime(outcome.result.value)
				return
			}
			state.runtime = outcome.result.value
			state.phase = 'ready'
			state.runtimeRetryAttempt = 0
			state.processorRetryAttempt = 0
			monitorProcessor(state, state.runtime, state.runtime.processor)
		} finally {
			releaseStartSlot()
			if (!initializing && state.generation === generation) scheduleRuntimeRetry(state)
		}
	}

	function waitForBorrowDrain(state: RuntimeState): Promise<void> {
		if (state.activeBorrows === 0) return Promise.resolve()
		return new Promise((resolve) => state.borrowDrainWaiters.add(resolve))
	}

	function close(): Promise<void> {
		closePromise ??= (async () => {
			closed = true
			if (reconciliationTimer !== undefined) clearTimeout(reconciliationTimer)
			reconciliationTimer = undefined
			pendingRegistrationSignals.clear()
			const runtimes: PortfolioCoreRuntime[] = []
			const draining: Promise<void>[] = []
			for (const state of states.values()) {
				state.generation += 1
				state.processorGeneration += 1
				state.phase = 'stopping'
				if (state.runtimeRetryTimer !== undefined) clearTimeout(state.runtimeRetryTimer)
				if (state.processorRetryTimer !== undefined) clearTimeout(state.processorRetryTimer)
				state.runtimeRetryTimer = undefined
				state.processorRetryTimer = undefined
				if (state.runtime === undefined) continue
				runtimes.push(state.runtime)
				draining.push(
					state.runtime.stopProcessor().catch(() => {}),
					waitForBorrowDrain(state),
				)
				if (state.processorCandidate !== undefined) draining.push(state.processorCandidate.stop().catch(() => {}))
			}

			let shutdownDeadline: ReturnType<typeof setTimeout> | undefined
			await Promise.race([
				Promise.all(draining),
				new Promise<void>((resolve) => {
					shutdownDeadline = setTimeout(resolve, input.config.shutdownGraceMs)
				}),
			])
			if (shutdownDeadline !== undefined) clearTimeout(shutdownDeadline)
			await Promise.all(runtimes.map(async (runtime) => runtime.closeStorage().catch(() => {})))
		})()
		return closePromise
	}

	function scheduleReconciliation(): void {
		if (closed || reconciliationTimer !== undefined) return
		reconciliationTimer = setTimeout(() => {
			reconciliationTimer = undefined
			void (async () => {
				try {
					const portfolios = await dependencies.listPortfolios(input.serverStorage)
					await Promise.all(
						portfolios.map(async (portfolio) => {
							const state = states.get(portfolio.id)
							if (state !== undefined) {
								state.portfolio = portfolio
								return
							}
							await startRuntime(portfolio)
						}),
					)
				} catch {
					log.warn('Portfolio Registry reconciliation failed.', { reason: 'registry-read-failed' })
				} finally {
					scheduleReconciliation()
				}
			})()
		}, input.config.reconciliationIntervalMs)
	}

	function portfolioRegistered(portfolioId: string): void {
		if (closed || states.has(portfolioId) || pendingRegistrationSignals.has(portfolioId)) return
		pendingRegistrationSignals.add(portfolioId)
		queueMicrotask(() => {
			void (async () => {
				try {
					const portfolio = await dependencies.findPortfolio(input.serverStorage, portfolioId)
					if (!closed && portfolio !== null && !states.has(portfolio.id)) await startRuntime(portfolio)
				} catch {
					log.warn('Portfolio registration signal could not be resolved.', { portfolioId, reason: 'registry-read-failed' })
				} finally {
					pendingRegistrationSignals.delete(portfolioId)
				}
			})()
		})
	}

	return {
		start() {
			startPromise ??= (async () => {
				let portfolios: PortfolioRegistryEntry[]
				try {
					portfolios = await dependencies.listPortfolios(input.serverStorage)
				} catch {
					throw new Error('Portfolio Registry scan failed')
				}
				if (!closed) await Promise.all(portfolios.map((portfolio) => startRuntime(portfolio)))
				initializing = false
				for (const state of states.values()) scheduleRuntimeRetry(state)
				scheduleReconciliation()
			})()
			return startPromise
		},
		portfolioRegistered,
		async borrow(portfolioId, run) {
			const state = states.get(portfolioId)
			if (state?.phase !== 'ready' || state.runtime === undefined) {
				return { ok: false, error: { type: 'portfolio-core-unavailable' } }
			}
			state.activeBorrows += 1
			try {
				return { ok: true, value: await run(state.runtime.core) }
			} finally {
				state.activeBorrows -= 1
				if (state.activeBorrows === 0) {
					for (const resolve of state.borrowDrainWaiters) resolve()
					state.borrowDrainWaiters.clear()
				}
			}
		},
		close,
	}
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it, vi } = import.meta.vitest

	afterEach(() => vi.useRealTimers())

	describe('Portfolio Core Supervision', () => {
		it('fails startup when the initial Portfolio Registry scan fails', async () => {
			const supervision = createPortfolioCoreSupervisionWith(testInput(), {
				listPortfolios: vi.fn().mockRejectedValue(new Error('registry unavailable')),
				findPortfolio: vi.fn(),
				openRuntime: vi.fn(),
				random: () => 0.5,
			})

			await expect(supervision.start()).rejects.toThrow('Portfolio Registry scan failed')
		})

		it('attempts every registered Portfolio while isolating an individual runtime failure', async () => {
			const first = testPortfolio('01k00000000000000000000001', 'portfolios/first')
			const second = testPortfolio('01k00000000000000000000002', 'portfolios/second')
			const openedPortfolioIds: string[] = []
			const openRuntime = vi.fn().mockImplementation(({ portfolio }: { portfolio: PortfolioRegistryEntry }) => {
				openedPortfolioIds.push(portfolio.id)
				return Promise.resolve(
					portfolio.id === first.id
						? { ok: false, error: { type: 'portfolio-core-runtime-start-failed', reason: 'core-preflight-failed' } }
						: { ok: true, value: testRuntime(second) },
				)
			})
			const supervision = createPortfolioCoreSupervisionWith(testInput(), {
				listPortfolios: vi.fn().mockResolvedValue([first, second]),
				findPortfolio: vi.fn(),
				openRuntime,
				random: () => 0.5,
			})

			await expect(supervision.start()).resolves.toBeUndefined()
			expect(openRuntime).toHaveBeenCalledTimes(2)
			expect(openedPortfolioIds).toEqual([first.id, second.id])
		})

		it('bounds concurrent runtime starts across the initial scan', async () => {
			const portfolios = Array.from({ length: 6 }, (_value, index) =>
				testPortfolio(`01k0000000000000000000000${index + 1}`, `portfolios/${index + 1}`),
			)
			const releases: Array<() => void> = []
			let active = 0
			let maximumActive = 0
			const openRuntime = vi.fn(({ portfolio }: { portfolio: PortfolioRegistryEntry }) => {
				active += 1
				maximumActive = Math.max(maximumActive, active)
				return new Promise((resolve) => {
					releases.push(() => {
						active -= 1
						resolve({ ok: true, value: testRuntime(portfolio) })
					})
				})
			})
			const supervision = createPortfolioCoreSupervisionWith(
				{ ...testInput(), config: { ...testInput().config, maxConcurrentStarts: 2 } },
				{
					listPortfolios: vi.fn().mockResolvedValue(portfolios),
					findPortfolio: vi.fn(),
					openRuntime,
					random: () => 0.5,
				} as PortfolioCoreSupervisionDependencies,
			)

			const started = supervision.start()
			for (let index = 0; index < portfolios.length; index += 1) {
				await vi.waitFor(() => expect(releases[index]).toBeTypeOf('function'))
				releases[index]?.()
			}
			await started

			expect(openRuntime).toHaveBeenCalledTimes(portfolios.length)
			expect(maximumActive).toBe(2)
		})

		it('retries a degraded runtime with capped exponential backoff and resets after readiness', async () => {
			vi.useFakeTimers()
			const portfolio = testPortfolio('01k00000000000000000000001', 'portfolios/retry')
			let attempts = 0
			const runtime = testRuntime(portfolio)
			const openRuntime = vi.fn(() => {
				attempts += 1
				return Promise.resolve(
					attempts < 4
						? { ok: false, error: { type: 'portfolio-core-runtime-start-failed', reason: 'storage-open-failed' } }
						: { ok: true, value: runtime },
				)
			})
			const supervision = createPortfolioCoreSupervisionWith(testInput(), {
				listPortfolios: vi.fn().mockResolvedValue([portfolio]),
				findPortfolio: vi.fn(),
				openRuntime,
				random: () => 0.5,
			} as PortfolioCoreSupervisionDependencies)
			await supervision.start()
			expect(openRuntime).toHaveBeenCalledTimes(1)

			await vi.advanceTimersByTimeAsync(1_000)
			expect(openRuntime).toHaveBeenCalledTimes(2)
			await vi.advanceTimersByTimeAsync(2_000)
			expect(openRuntime).toHaveBeenCalledTimes(3)
			await vi.advanceTimersByTimeAsync(4_000)
			expect(openRuntime).toHaveBeenCalledTimes(4)
			await expect(supervision.borrow(portfolio.id, () => Promise.resolve('ready'))).resolves.toEqual({
				ok: true,
				value: 'ready',
			})
		})

		it('recovers a missed registration signal through periodic registry reconciliation', async () => {
			vi.useFakeTimers()
			const portfolio = testPortfolio('01k00000000000000000000001', 'portfolios/reconciled')
			const listPortfolios = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([portfolio])
			const openRuntime = vi.fn().mockResolvedValue({ ok: true, value: testRuntime(portfolio) })
			const supervision = createPortfolioCoreSupervisionWith(testInput(), {
				listPortfolios,
				findPortfolio: vi.fn(),
				openRuntime,
				random: () => 0.5,
			})
			await supervision.start()

			await vi.advanceTimersByTimeAsync(29_999)
			expect(openRuntime).not.toHaveBeenCalled()
			await vi.advanceTimersByTimeAsync(1)
			expect(openRuntime).toHaveBeenCalledOnce()
			await expect(supervision.borrow(portfolio.id, () => Promise.resolve('ready'))).resolves.toEqual({
				ok: true,
				value: 'ready',
			})
		})

		it('starts a newly registered Portfolio from one coalesced id-only signal', async () => {
			const portfolio = testPortfolio('01k00000000000000000000001', 'portfolios/new')
			const findPortfolio = vi.fn().mockResolvedValue(portfolio)
			const openRuntime = vi.fn().mockResolvedValue({ ok: true, value: testRuntime(portfolio) })
			const supervision = createPortfolioCoreSupervisionWith(testInput(), {
				listPortfolios: vi.fn().mockResolvedValue([]),
				findPortfolio,
				openRuntime,
				random: () => 0.5,
			})
			await supervision.start()

			expect(supervision.portfolioRegistered(portfolio.id)).toBeUndefined()
			supervision.portfolioRegistered(portfolio.id)
			await vi.waitFor(() => expect(findPortfolio).toHaveBeenCalledOnce())
			await vi.waitFor(() => expect(openRuntime).toHaveBeenCalledOnce())
			await expect(supervision.borrow(portfolio.id, () => Promise.resolve('ready'))).resolves.toEqual({
				ok: true,
				value: 'ready',
			})
			expect(findPortfolio).toHaveBeenCalledWith({} as ServerStorage, portfolio.id)
		})

		it('applies jitter and a maximum delay to indefinite runtime retries', async () => {
			vi.useFakeTimers()
			const portfolio = testPortfolio('01k00000000000000000000001', 'portfolios/jitter')
			const openRuntime = vi
				.fn()
				.mockResolvedValue({ ok: false, error: { type: 'portfolio-core-runtime-start-failed', reason: 'storage-open-failed' } })
			const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValue(0.5)
			const supervision = createPortfolioCoreSupervisionWith(
				{
					...testInput(),
					config: { ...testInput().config, retryMaxDelayMs: 4_000 },
				},
				{
					listPortfolios: vi.fn().mockResolvedValue([portfolio]),
					findPortfolio: vi.fn(),
					openRuntime,
					random,
				},
			)
			await supervision.start()

			await vi.advanceTimersByTimeAsync(799)
			expect(openRuntime).toHaveBeenCalledTimes(1)
			await vi.advanceTimersByTimeAsync(1)
			expect(openRuntime).toHaveBeenCalledTimes(2)
			await vi.advanceTimersByTimeAsync(2_399)
			expect(openRuntime).toHaveBeenCalledTimes(2)
			await vi.advanceTimersByTimeAsync(1)
			expect(openRuntime).toHaveBeenCalledTimes(3)
			await vi.advanceTimersByTimeAsync(4_000)
			expect(openRuntime).toHaveBeenCalledTimes(4)
			await vi.advanceTimersByTimeAsync(4_000)
			expect(openRuntime).toHaveBeenCalledTimes(5)
		})

		it('fences a timed-out runtime generation and cleans it if it completes later', async () => {
			vi.useFakeTimers()
			const portfolio = testPortfolio('01k00000000000000000000001', 'portfolios/timed-out')
			let resolveOpen: ((result: Result<PortfolioCoreRuntime, never>) => void) | undefined
			const openRuntime = vi.fn(
				() =>
					new Promise<Result<PortfolioCoreRuntime, never>>((resolve) => {
						resolveOpen = resolve
					}),
			)
			const supervision = createPortfolioCoreSupervisionWith(
				{ ...testInput(), config: { ...testInput().config, runtimeStartTimeoutMs: 100 } },
				{
					listPortfolios: vi.fn().mockResolvedValue([portfolio]),
					findPortfolio: vi.fn(),
					openRuntime,
					random: () => 0.5,
				},
			)
			const started = supervision.start()

			await vi.advanceTimersByTimeAsync(0)
			expect(resolveOpen).toBeTypeOf('function')
			await vi.advanceTimersByTimeAsync(100)
			await started
			const staleRuntime = testRuntime(portfolio)
			resolveOpen?.({ ok: true, value: staleRuntime })
			await vi.advanceTimersByTimeAsync(0)

			expect(staleRuntime.stopProcessor).toHaveBeenCalledOnce()
			expect(staleRuntime.closeStorage).toHaveBeenCalledOnce()
			await expect(supervision.borrow(portfolio.id, vi.fn())).resolves.toEqual({
				ok: false,
				error: { type: 'portfolio-core-unavailable' },
			})
		})

		it('stops processor claims and drains active borrows before closing runtime storage', async () => {
			const portfolio = testPortfolio('01k00000000000000000000001', 'portfolios/shutdown')
			const runtime = testRuntime(portfolio)
			const supervision = createPortfolioCoreSupervisionWith(testInput(), {
				listPortfolios: vi.fn().mockResolvedValue([portfolio]),
				findPortfolio: vi.fn(),
				openRuntime: vi.fn().mockResolvedValue({ ok: true, value: runtime }),
				random: () => 0.5,
			})
			await supervision.start()
			let releaseBorrow: (() => void) | undefined
			const borrowed = supervision.borrow(
				portfolio.id,
				() =>
					new Promise<void>((resolve) => {
						releaseBorrow = resolve
					}),
			)
			await vi.waitFor(() => expect(releaseBorrow).toBeTypeOf('function'))

			const closing = supervision.close()
			await vi.waitFor(() => expect(runtime.stopProcessor).toHaveBeenCalledOnce())
			expect(runtime.closeStorage).not.toHaveBeenCalled()
			await expect(supervision.borrow(portfolio.id, vi.fn())).resolves.toEqual({
				ok: false,
				error: { type: 'portfolio-core-unavailable' },
			})
			releaseBorrow?.()
			await borrowed
			await closing

			expect(runtime.closeStorage).toHaveBeenCalledOnce()
		})

		it('forces best-effort storage teardown when the total shutdown grace expires', async () => {
			vi.useFakeTimers()
			const portfolio = testPortfolio('01k00000000000000000000001', 'portfolios/forced-shutdown')
			const runtime = testRuntime(portfolio)
			runtime.stopProcessor = vi.fn(() => new Promise<void>(() => {}))
			const supervision = createPortfolioCoreSupervisionWith(testInput(), {
				listPortfolios: vi.fn().mockResolvedValue([portfolio]),
				findPortfolio: vi.fn(),
				openRuntime: vi.fn().mockResolvedValue({ ok: true, value: runtime }),
				random: () => 0.5,
			})
			await supervision.start()
			void supervision.borrow(portfolio.id, () => new Promise(() => {}))

			const closing = supervision.close()
			await vi.advanceTimersByTimeAsync(59_999)
			expect(runtime.closeStorage).not.toHaveBeenCalled()
			await vi.advanceTimersByTimeAsync(1)
			await closing

			expect(runtime.closeStorage).toHaveBeenCalledOnce()
		})

		it('stops a replacement processor generation whose readiness times out', async () => {
			vi.useFakeTimers()
			const portfolio = testPortfolio('01k00000000000000000000001', 'portfolios/processor-timeout')
			let completeInitial: ((result: Result<void, never>) => void) | undefined
			const initialProcessor = {
				...testRuntime(portfolio).processor,
				completed: new Promise<Result<void, never>>((resolve) => {
					completeInitial = resolve
				}),
			}
			const stopReplacement = vi.fn(() => Promise.resolve())
			const replacementProcessor = {
				...testRuntime(portfolio).processor,
				stop: stopReplacement,
				ready: new Promise<Result<void, never>>(() => {}),
			}
			const runtime = testRuntime(portfolio)
			Object.defineProperty(runtime, 'processor', { configurable: true, value: initialProcessor })
			runtime.core = {
				dispatch: { startProcessor: () => ({ ok: true, value: replacementProcessor }) },
			} as unknown as GorchestraCore
			const supervision = createPortfolioCoreSupervisionWith(
				{ ...testInput(), config: { ...testInput().config, runtimeStartTimeoutMs: 100 } },
				{
					listPortfolios: vi.fn().mockResolvedValue([portfolio]),
					findPortfolio: vi.fn(),
					openRuntime: vi.fn().mockResolvedValue({ ok: true, value: runtime }),
					random: () => 0.5,
				},
			)
			await supervision.start()

			completeInitial?.({ ok: false, error: {} as never })
			await vi.advanceTimersByTimeAsync(1_000)
			await vi.advanceTimersByTimeAsync(100)

			expect(stopReplacement).toHaveBeenCalledOnce()
			await expect(supervision.borrow(portfolio.id, () => Promise.resolve('available'))).resolves.toEqual({
				ok: true,
				value: 'available',
			})
		})

		it('keeps Core borrows ready while restarting a failed processor on the same runtime', async () => {
			vi.useFakeTimers()
			const portfolio = testPortfolio('01k00000000000000000000001', 'portfolios/processor-restart')
			let completeInitial: ((result: Result<void, never>) => void) | undefined
			const initialProcessor = {
				...testRuntime(portfolio).processor,
				completed: new Promise<Result<void, never>>((resolve) => {
					completeInitial = resolve
				}),
			}
			const replacementProcessor = testRuntime(portfolio).processor
			const startProcessor = vi.fn(() => ({ ok: true as const, value: replacementProcessor }))
			const runtime = testRuntime(portfolio)
			Object.defineProperty(runtime, 'processor', { configurable: true, value: initialProcessor })
			runtime.core = { dispatch: { startProcessor } } as unknown as GorchestraCore
			const openRuntime = vi.fn().mockResolvedValue({ ok: true, value: runtime })
			const supervision = createPortfolioCoreSupervisionWith(testInput(), {
				listPortfolios: vi.fn().mockResolvedValue([portfolio]),
				findPortfolio: vi.fn(),
				openRuntime,
				random: () => 0.5,
			})
			await supervision.start()

			completeInitial?.({ ok: false, error: {} as never })
			await vi.advanceTimersByTimeAsync(0)
			await expect(supervision.borrow(portfolio.id, () => Promise.resolve('available'))).resolves.toEqual({
				ok: true,
				value: 'available',
			})
			await vi.advanceTimersByTimeAsync(1_000)

			expect(startProcessor).toHaveBeenCalledWith(testInput().processor)
			expect(runtime.replaceProcessor).toHaveBeenCalledWith(replacementProcessor)
			expect(openRuntime).toHaveBeenCalledOnce()
		})

		it('borrows only a ready runtime by Portfolio Registry Entry id', async () => {
			const readyPortfolio = testPortfolio('01k00000000000000000000001', 'portfolios/shared-namespace')
			const degradedPortfolio = testPortfolio('01k00000000000000000000002', 'portfolios/degraded')
			const runtime = testRuntime(readyPortfolio)
			const supervision = createPortfolioCoreSupervisionWith(testInput(), {
				listPortfolios: vi.fn().mockResolvedValue([readyPortfolio, degradedPortfolio]),
				findPortfolio: vi.fn(),
				openRuntime: vi.fn(({ portfolio }: { portfolio: PortfolioRegistryEntry }) =>
					Promise.resolve(
						portfolio.id === readyPortfolio.id
							? { ok: true, value: runtime }
							: { ok: false, error: { type: 'portfolio-core-runtime-start-failed', reason: 'storage-open-failed' } },
					),
				),
				random: () => 0.5,
			} as PortfolioCoreSupervisionDependencies)
			await supervision.start()
			const run = vi.fn((core: GorchestraCore) => Promise.resolve(core === runtime.core ? 42 : 0))

			await expect(supervision.borrow(readyPortfolio.id, run)).resolves.toEqual({ ok: true, value: 42 })
			await expect(supervision.borrow(degradedPortfolio.id, run)).resolves.toEqual({
				ok: false,
				error: { type: 'portfolio-core-unavailable' },
			})
			expect(run).toHaveBeenCalledOnce()
		})
	})

	function testInput(): CreatePortfolioCoreSupervisionInput {
		return {
			serverStorage: {} as ServerStorage,
			corePortfolioStorage: { type: 'json', dataDir: '/tmp/gorchestra' },
			secretEncryptionKey: Buffer.alloc(32, 1),
			config: {
				reconciliationIntervalMs: 30_000,
				retryInitialDelayMs: 1_000,
				retryMaxDelayMs: 60_000,
				retryMultiplier: 2,
				retryJitterRatio: 0.2,
				runtimeStartTimeoutMs: 60_000,
				shutdownGraceMs: 60_000,
				maxConcurrentStarts: 4,
			},
			processor: {
				maxConcurrentAttempts: 4,
				heartbeatMs: 10_000,
				leaseMs: 60_000,
				idlePollMinMs: 100,
				idlePollMaxMs: 5_000,
				interruptedAttemptLimit: 5,
				completedRetentionMs: 86_400_000,
				pruneBatchSize: 100,
				shutdownGraceMs: 30_000,
			},
			publishNotification: vi.fn(),
		}
	}

	function testPortfolio(id: string, coreStorageNamespace: string): PortfolioRegistryEntry {
		return {
			id,
			workspaceId: '01k00000000000000000000003',
			displayName: id,
			coreStorageNamespace,
			registeredAt: '2026-07-14T00:00:00.000Z',
		}
	}

	function testRuntime(portfolio: PortfolioRegistryEntry): PortfolioCoreRuntime {
		return {
			portfolioId: portfolio.id,
			coreStorageNamespace: portfolio.coreStorageNamespace,
			core: {} as GorchestraCore,
			processor: {
				status: () => ({ type: 'running', activeAttempts: 0 }),
				stop: vi.fn(() => Promise.resolve()),
				ready: Promise.resolve({ ok: true, value: undefined }),
				completed: new Promise(() => {}),
			},
			replaceProcessor: vi.fn(),
			stopProcessor: vi.fn(() => Promise.resolve()),
			closeStorage: vi.fn(() => Promise.resolve()),
		}
	}
}
