import { openCore, type CoreDispatchRequest, type CoreServices } from '@gorchestra/core'
import { Instance } from 'equipped'

import type { SecretEncryptionKey } from './secret-protection'
import { createCoreServices } from '../core/services'
import { openCorePortfolioStorage } from '../core/storage'

export type ServerDispatchRequest = {
	coreStorageNamespace: string
	request: CoreDispatchRequest
}

export type ServerAgentRunDispatchItem = {
	type: 'agent-run'
	coreStorageNamespace: string
	agentRunId: string
	serializationKey: string
}

export type CreateServerDispatcherInput = {
	dataDir: string
	secretEncryptionKey: SecretEncryptionKey
	runAgentRun?: (item: ServerAgentRunDispatchItem) => Promise<void>
}

export type ServerDispatcher = ReturnType<typeof createServerDispatcher>

export function createServerDispatcher(input: CreateServerDispatcherInput) {
	const pending = new Map<string, ServerAgentRunDispatchItem>()
	const queuesBySerializationKey = new Map<string, ServerAgentRunDispatchItem[]>()
	const runningSerializationKeys = new Set<string>()

	function preflight(): Promise<{ ok: true }> {
		return Promise.resolve({ ok: true })
	}

	function request(request: ServerDispatchRequest): Promise<string> {
		const marker = Instance.createId()
		if (request.request.type === 'agent-run') pending.set(marker, agentRunItem(request))
		return Promise.resolve(marker)
	}

	function ready(marker: string): void {
		const item = pending.get(marker)
		if (item === undefined) return
		pending.delete(marker)
		enqueue(item)
	}

	function agentRunItem(request: ServerDispatchRequest): ServerAgentRunDispatchItem {
		return {
			type: 'agent-run',
			coreStorageNamespace: request.coreStorageNamespace,
			agentRunId: request.request.agentRunId,
			serializationKey: request.request.serializationKey,
		}
	}

	function enqueue(item: ServerAgentRunDispatchItem): void {
		const itemKey = scopedSerializationKey(item)
		const queue = queuesBySerializationKey.get(itemKey) ?? []
		queue.push(item)
		queuesBySerializationKey.set(itemKey, queue)
		if (!runningSerializationKeys.has(itemKey)) scheduleNextForSerializationKey(itemKey)
	}

	function scheduleNextForSerializationKey(itemKey: string): void {
		if (runningSerializationKeys.has(itemKey)) return

		const queue = queuesBySerializationKey.get(itemKey)
		if (queue === undefined) return

		const item = queue.shift()
		if (item === undefined) {
			queuesBySerializationKey.delete(itemKey)
			return
		}

		if (queue.length === 0) queuesBySerializationKey.delete(itemKey)
		runningSerializationKeys.add(itemKey)
		setTimeout(() => void runClaimedItem(item), 0)
	}

	async function runClaimedItem(item: ServerAgentRunDispatchItem): Promise<void> {
		try {
			await runItem(item)
		} catch (error) {
			globalThis.console.error('Agent Run dispatch failed', error)
		} finally {
			releaseClaimedItem(item)
		}
	}

	function releaseClaimedItem(item: ServerAgentRunDispatchItem): void {
		const itemKey = scopedSerializationKey(item)
		runningSerializationKeys.delete(itemKey)
		scheduleNextForSerializationKey(itemKey)
	}

	async function runItem(item: ServerAgentRunDispatchItem): Promise<void> {
		if (input.runAgentRun !== undefined) return input.runAgentRun(item)

		const coreStorage = await openCorePortfolioStorage({ dataDir: input.dataDir, coreStorageNamespace: item.coreStorageNamespace })
		try {
			const services = createCoreServices(coreStorage.storage, {
				secretEncryptionKey: input.secretEncryptionKey,
				dispatcher: coreDispatcherForNamespace(item.coreStorageNamespace),
			})
			const opened = openCore(services)
			if (!opened.ok) throw new Error(`Core open failed: ${opened.error.type}`)
			const result = await opened.value.work.runModelAgentRun({ agentRunId: item.agentRunId }, { correlationId: null })
			if (!result.ok) globalThis.console.error('Agent Run work failed', result.error)
		} finally {
			await coreStorage.close()
		}
	}

	function coreDispatcherForNamespace(coreStorageNamespace: string): CoreServices['dispatcher'] {
		return {
			preflight,
			request: (request) => requestForNamespace(coreStorageNamespace, request),
			ready,
		}
	}

	function requestForNamespace(coreStorageNamespace: string, coreRequest: CoreDispatchRequest): Promise<string> {
		return request({ coreStorageNamespace, request: coreRequest })
	}

	function scopedSerializationKey(item: ServerAgentRunDispatchItem): string {
		return JSON.stringify([item.coreStorageNamespace, item.serializationKey])
	}

	return { preflight, request, ready }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server Agent Run dispatcher', () => {
		it('does not process accepted requests until their marker is ready', async () => {
			const started: string[] = []
			const dispatcher = createServerDispatcher({
				dataDir: '/tmp/gorchestra-test',
				secretEncryptionKey: Buffer.alloc(32, 1),
				runAgentRun: (item) => {
					started.push(item.agentRunId)
					return Promise.resolve()
				},
			})

			const marker = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1'))
			await new Promise((resolve) => setTimeout(resolve, 0))
			expect(started).toEqual([])

			dispatcher.ready(marker)
			await waitFor(() => started.length === 1)
			expect(started).toEqual(['agent-run-1'])
		})

		it('runs same-key readied requests serially without coalescing them', async () => {
			const started: string[] = []
			const completed: string[] = []
			let releaseFirst!: () => void
			const firstRun = new Promise<void>((resolve) => {
				releaseFirst = resolve
			})
			const dispatcher = createServerDispatcher({
				dataDir: '/tmp/gorchestra-test',
				secretEncryptionKey: Buffer.alloc(32, 1),
				runAgentRun: async (item) => {
					started.push(item.agentRunId)
					if (started.length === 1) await firstRun
					completed.push(item.agentRunId)
				},
			})

			const first = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1', 'serial-a'))
			const second = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1', 'serial-a'))
			dispatcher.ready(first)
			dispatcher.ready(second)
			await waitFor(() => started.length === 1)
			expect(completed).toEqual([])

			releaseFirst()
			await waitFor(() => completed.length === 2)
			expect(started).toEqual(['agent-run-1', 'agent-run-1'])
			expect(completed).toEqual(['agent-run-1', 'agent-run-1'])
		})

		it('allows different serialization keys in the same Portfolio to run concurrently', async () => {
			const { completed, dispatcher, releaseFirst, releaseSecond, started } = concurrentDispatchFixture(
				(item) => item.serializationKey,
				'serial-a',
				'serial-b',
			)

			const first = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1', 'serial-a'))
			const second = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-2', 'serial-b'))
			dispatcher.ready(first)
			dispatcher.ready(second)
			await waitFor(() => started.length === 2)
			expect(completed).toEqual([])

			releaseFirst()
			releaseSecond()
			await waitFor(() => completed.length === 2)
			expect(started).toEqual(['serial-a', 'serial-b'])
		})

		it('scopes serialization keys by Portfolio storage namespace', async () => {
			const { completed, dispatcher, releaseFirst, releaseSecond, started } = concurrentDispatchFixture(
				(item) => item.coreStorageNamespace,
				'portfolio-a',
				'portfolio-b',
			)

			const first = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1', 'serial-a'))
			const second = await dispatcher.request(agentRunDispatch('portfolio-b', 'agent-run-2', 'serial-a'))
			dispatcher.ready(first)
			dispatcher.ready(second)
			await waitFor(() => started.length === 2)
			expect(started).toEqual(['portfolio-a', 'portfolio-b'])

			releaseFirst()
			releaseSecond()
			await waitFor(() => completed.length === 2)
		})

		it('continues same-key queued dispatches after a failed attempt', async () => {
			const started: string[] = []
			const completed: string[] = []
			const errors = await withCapturedConsoleErrors(async () => {
				const dispatcher = createServerDispatcher({
					dataDir: '/tmp/gorchestra-test',
					secretEncryptionKey: Buffer.alloc(32, 1),
					runAgentRun: (item) => {
						started.push(item.agentRunId)
						if (started.length === 1) throw new Error('first dispatch failed')
						completed.push(item.agentRunId)
						return Promise.resolve()
					},
				})

				const first = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1', 'serial-a'))
				const second = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-2', 'serial-a'))
				dispatcher.ready(first)
				dispatcher.ready(second)
				await waitFor(() => started.length === 2 && completed.length === 1)
			})

			expect(started).toEqual(['agent-run-1', 'agent-run-2'])
			expect(completed).toEqual(['agent-run-2'])
			expect(errors).toHaveLength(1)
		})

		it('ignores unknown or already readied dispatch markers', async () => {
			const started: string[] = []
			const dispatcher = createServerDispatcher({
				dataDir: '/tmp/gorchestra-test',
				secretEncryptionKey: Buffer.alloc(32, 1),
				runAgentRun: (item) => {
					started.push(item.agentRunId)
					return Promise.resolve()
				},
			})

			const marker = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1'))
			dispatcher.ready('missing-marker')
			dispatcher.ready(marker)
			dispatcher.ready(marker)
			await waitFor(() => started.length === 1)

			expect(started).toEqual(['agent-run-1'])
		})
	})

	function agentRunDispatch(coreStorageNamespace: string, agentRunId: string, serializationKey = agentRunId): ServerDispatchRequest {
		return {
			coreStorageNamespace,
			request: {
				type: 'agent-run',
				agentRunId,
				serializationKey,
				reason: { type: 'input-appended', inputEventId: 'event-1' },
			},
		}
	}

	function concurrentDispatchFixture(recordKey: (item: ServerAgentRunDispatchItem) => string, firstKey: string, secondKey: string) {
		const firstGate = releaseGate()
		const secondGate = releaseGate()
		const started: string[] = []
		const completed: string[] = []
		const dispatcher = createServerDispatcher({
			dataDir: '/tmp/gorchestra-test',
			secretEncryptionKey: Buffer.alloc(32, 1),
			runAgentRun: async (item) => {
				const itemKey = recordKey(item)
				started.push(itemKey)
				if (itemKey === firstKey) await firstGate.promise
				if (itemKey === secondKey) await secondGate.promise
				completed.push(itemKey)
			},
		})
		return { completed, dispatcher, releaseFirst: firstGate.release, releaseSecond: secondGate.release, started }
	}

	function releaseGate(): { promise: Promise<void>; release: () => void } {
		let release!: () => void
		const promise = new Promise<void>((resolve) => {
			release = resolve
		})
		return { promise, release }
	}

	async function waitFor(predicate: () => boolean): Promise<void> {
		for (let attempt = 0; attempt < 30; attempt += 1) {
			if (predicate()) return
			await new Promise((resolve) => setTimeout(resolve, 0))
		}
		throw new Error('Timed out waiting for condition')
	}

	async function withCapturedConsoleErrors(run: () => Promise<void>): Promise<unknown[][]> {
		const originalError = globalThis.console.error
		const errors: unknown[][] = []
		globalThis.console.error = (...args: unknown[]) => {
			errors.push(args)
		}
		try {
			await run()
			return errors
		} finally {
			globalThis.console.error = originalError
		}
	}
}
