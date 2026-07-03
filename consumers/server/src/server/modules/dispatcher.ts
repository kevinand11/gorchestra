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
}

export type CreateServerDispatcherInput = {
	dataDir: string
	secretEncryptionKey: SecretEncryptionKey
	runAgentRun?: (item: ServerAgentRunDispatchItem) => Promise<void>
}

export type ServerDispatcher = ReturnType<typeof createServerDispatcher>

export function createServerDispatcher(input: CreateServerDispatcherInput) {
	const queue: string[] = []
	const pending = new Map<string, ServerAgentRunDispatchItem>()
	const queued = new Map<string, ServerAgentRunDispatchItem>()
	const running = new Map<string, ServerAgentRunDispatchItem>()
	const rerunRequested = new Set<string>()
	let drainScheduled = false

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
		return { type: 'agent-run', coreStorageNamespace: request.coreStorageNamespace, agentRunId: request.request.agentRunId }
	}

	function enqueue(item: ServerAgentRunDispatchItem): void {
		const itemKey = key(item)
		if (running.has(itemKey)) {
			rerunRequested.add(itemKey)
			return
		}
		if (queued.has(itemKey)) return
		queued.set(itemKey, item)
		queue.push(itemKey)
		scheduleDrain()
	}

	function scheduleDrain(): void {
		if (drainScheduled) return
		drainScheduled = true
		setTimeout(() => void drain(), 0)
	}

	async function drain(): Promise<void> {
		drainScheduled = false
		const item = claimNextQueuedItem()
		if (item === null) return scheduleNextIfNeeded()
		await runClaimedItem(item)
	}

	function claimNextQueuedItem(): ServerAgentRunDispatchItem | null {
		const itemKey = queue.shift()
		if (itemKey === undefined) return null
		const item = queued.get(itemKey)
		if (item === undefined) return null
		queued.delete(itemKey)
		running.set(itemKey, item)
		return item
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
		const itemKey = key(item)
		running.delete(itemKey)
		if (rerunRequested.delete(itemKey)) enqueue(item)
		scheduleNextIfNeeded()
	}

	function scheduleNextIfNeeded(): void {
		if (queue.length > 0) scheduleDrain()
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

	function key(item: ServerAgentRunDispatchItem): string {
		return `${item.coreStorageNamespace}:${item.agentRunId}`
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

		it('coalesces queued duplicate requests for the same AgentRun', async () => {
			const started: string[] = []
			const dispatcher = createServerDispatcher({
				dataDir: '/tmp/gorchestra-test',
				secretEncryptionKey: Buffer.alloc(32, 1),
				runAgentRun: (item) => {
					started.push(`${item.coreStorageNamespace}:${item.agentRunId}`)
					return Promise.resolve()
				},
			})

			const first = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1'))
			const second = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1'))
			dispatcher.ready(first)
			dispatcher.ready(second)
			await waitFor(() => started.length === 1)

			expect(started).toEqual(['portfolio-a:agent-run-1'])
		})

		it('does not run two dispatches for the same AgentRun concurrently and reruns after current run', async () => {
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

			const first = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1'))
			dispatcher.ready(first)
			await waitFor(() => started.length === 1)
			const second = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1'))
			dispatcher.ready(second)
			await new Promise((resolve) => setTimeout(resolve, 0))
			expect(started).toEqual(['agent-run-1'])

			releaseFirst()
			await waitFor(() => completed.length === 2)
			expect(started).toEqual(['agent-run-1', 'agent-run-1'])
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

	function agentRunDispatch(coreStorageNamespace: string, agentRunId: string): ServerDispatchRequest {
		return {
			coreStorageNamespace,
			request: { type: 'agent-run', agentRunId, reason: { type: 'input-appended', inputEventId: 'event-1' } },
		}
	}

	async function waitFor(predicate: () => boolean): Promise<void> {
		for (let attempt = 0; attempt < 30; attempt += 1) {
			if (predicate()) return
			await new Promise((resolve) => setTimeout(resolve, 0))
		}
		throw new Error('Timed out waiting for condition')
	}
}
