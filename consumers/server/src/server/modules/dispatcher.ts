import {
	openCore,
	type CoreDispatchRequest,
	type CoreServices,
	type DispatchCoordinationClaim,
	type DispatchCoordinationScopeSegment,
} from '@gorchestra/core'
import { Instance } from 'equipped'

import type { SecretEncryptionKey } from './secret-protection'
import type { ServerConsumerCorePortfolioStorageConfig } from '../config'
import { createCoreServices } from '../core/services'
import { openCorePortfolioStorage } from '../core/storage'

export type ServerDispatchRequest = {
	coreStorageNamespace: string
	request: CoreDispatchRequest
}

export type ServerDispatchItem = {
	coreStorageNamespace: string
	request: CoreDispatchRequest
	sequence: number
}

type ServerDispatchCoordinationScopeSegment = { type: 'portfolio-namespace'; id: string } | DispatchCoordinationScopeSegment

type ServerDispatchCoordinationClaim = Omit<DispatchCoordinationClaim, 'scope'> & {
	scope: ServerDispatchCoordinationScopeSegment[]
}

export type CreateServerDispatcherInput = {
	corePortfolioStorage: ServerConsumerCorePortfolioStorageConfig
	secretEncryptionKey: SecretEncryptionKey
	runDispatchItem?: (item: ServerDispatchItem) => Promise<void>
}

export type ServerDispatcher = ReturnType<typeof createServerDispatcher>

export function createServerDispatcher(input: CreateServerDispatcherInput) {
	const pending = new Map<string, ServerDispatchItem>()
	const readyItems: ServerDispatchItem[] = []
	const activeClaims: Array<{ item: ServerDispatchItem; claim: ServerDispatchCoordinationClaim }> = []
	let nextSequence = 0
	let isScheduling = false
	let isScheduleQueued = false

	function preflight(): Promise<{ ok: true }> {
		return Promise.resolve({ ok: true })
	}

	function request(request: ServerDispatchRequest): Promise<string> {
		const marker = Instance.createId()
		pending.set(marker, {
			coreStorageNamespace: request.coreStorageNamespace,
			request: request.request,
			sequence: nextSequence,
		})
		nextSequence += 1
		return Promise.resolve(marker)
	}

	function ready(marker: string): void {
		const item = pending.get(marker)
		if (item === undefined) return
		pending.delete(marker)
		readyItems.push(item)
		scheduleAvailableSoon()
	}

	function scheduleAvailableSoon(): void {
		if (isScheduleQueued) return
		isScheduleQueued = true
		setTimeout(() => {
			isScheduleQueued = false
			scheduleAvailable()
		}, 0)
	}

	function scheduleAvailable(): void {
		if (isScheduling) return
		isScheduling = true
		try {
			while (true) {
				const index = nextAcquirableItemIndex()
				if (index < 0) return

				const [item] = readyItems.splice(index, 1)
				if (item === undefined) return
				claimAndRun(item)
			}
		} finally {
			isScheduling = false
		}
	}

	function nextAcquirableItemIndex(): number {
		return (
			readyItems
				.map((item, index) => ({ item, index }))
				.filter(({ item }) => canAcquire(item))
				.sort((left, right) => compareReadyItems(left.item, right.item))
				.at(0)?.index ?? -1
		)
	}

	function compareReadyItems(left: ServerDispatchItem, right: ServerDispatchItem): number {
		return scopePriority(left) - scopePriority(right) || left.sequence - right.sequence
	}

	function scopePriority(item: ServerDispatchItem): number {
		return Math.min(...item.request.coordinationClaims.map((claim) => claim.scope.length))
	}

	function canAcquire(item: ServerDispatchItem): boolean {
		return scopedClaims(item).every((claim) => !conflictsWithActive(claim))
	}

	function conflictsWithActive(candidate: ServerDispatchCoordinationClaim): boolean {
		for (const { claim: active } of activeClaims) {
			if ((candidate.mode.type === 'exclusive' || active.mode.type === 'exclusive') && scopesOverlap(candidate.scope, active.scope)) {
				return true
			}
		}

		return candidate.mode.type === 'shared-capacity' ? sharedCapacityCount(candidate.scope) >= candidate.mode.capacity : false
	}

	function sharedCapacityCount(scope: ServerDispatchCoordinationClaim['scope']): number {
		return activeClaims.filter(({ claim }) => claim.mode.type === 'shared-capacity' && scopesEqual(claim.scope, scope)).length
	}

	function claimAndRun(item: ServerDispatchItem): void {
		for (const claim of scopedClaims(item)) activeClaims.push({ item, claim })
		setTimeout(() => void runClaimedItem(item), 0)
	}

	async function runClaimedItem(item: ServerDispatchItem): Promise<void> {
		try {
			await runItem(item)
		} catch (error) {
			globalThis.console.error('Core dispatch failed', error)
		} finally {
			releaseClaimedItem(item)
		}
	}

	function releaseClaimedItem(item: ServerDispatchItem): void {
		for (let index = activeClaims.length - 1; index >= 0; index -= 1) {
			if (activeClaims[index]?.item === item) activeClaims.splice(index, 1)
		}
		scheduleAvailableSoon()
	}

	async function runItem(item: ServerDispatchItem): Promise<void> {
		if (input.runDispatchItem !== undefined) return input.runDispatchItem(item)

		const coreStorage = await openCorePortfolioStorage({
			config: input.corePortfolioStorage,
			coreStorageNamespace: item.coreStorageNamespace,
		})
		try {
			const services = createCoreServices(coreStorage.storage, {
				secretEncryptionKey: input.secretEncryptionKey,
				dispatcher: coreDispatcherForNamespace(item.coreStorageNamespace),
			})
			const opened = openCore(services)
			if (!opened.ok) throw new Error(`Core open failed: ${opened.error.type}`)

			switch (item.request.type) {
				case 'agent-run': {
					const result = await opened.value.work.runModelAgentRun(
						{ agentRunId: item.request.agentRunId },
						{ correlationId: null },
					)
					if (!result.ok) globalThis.console.error('Agent Run work failed', result.error)
					return
				}
				case 'delivery-work-scheduler': {
					const result = await opened.value.work.runDeliveryWork({ deliveryId: item.request.deliveryId }, { correlationId: null })
					if (!result.ok) globalThis.console.error('Delivery work scheduler failed', result.error)
					return
				}
				case 'delivery-work-operation': {
					globalThis.console.error('Delivery work operation dispatch is not implemented yet', item.request)
					return
				}
				default:
					throw new Error(`Unexpected Core Dispatch Request type: ${String(item.request satisfies never)}`)
			}
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

	function scopedClaims(item: ServerDispatchItem): ServerDispatchCoordinationClaim[] {
		return item.request.coordinationClaims.map((claim) => ({
			...claim,
			scope: [{ type: 'portfolio-namespace', id: item.coreStorageNamespace }, ...claim.scope],
		}))
	}

	return { preflight, request, ready }
}

function scopesOverlap(left: ServerDispatchCoordinationClaim['scope'], right: ServerDispatchCoordinationClaim['scope']): boolean {
	return isPrefix(left, right) || isPrefix(right, left)
}

function isPrefix(ancestor: ServerDispatchCoordinationClaim['scope'], descendant: ServerDispatchCoordinationClaim['scope']): boolean {
	return ancestor.length <= descendant.length && ancestor.every((segment, index) => sameSegment(segment, descendant[index]!))
}

function scopesEqual(left: ServerDispatchCoordinationClaim['scope'], right: ServerDispatchCoordinationClaim['scope']): boolean {
	return left.length === right.length && left.every((segment, index) => sameSegment(segment, right[index]!))
}

function sameSegment(left: ServerDispatchCoordinationScopeSegment, right: ServerDispatchCoordinationScopeSegment): boolean {
	return segmentKey(left) === segmentKey(right)
}

function segmentKey(segment: ServerDispatchCoordinationScopeSegment): string {
	switch (segment.type) {
		case 'portfolio-namespace':
		case 'agent-run':
		case 'delivery':
		case 'slice':
			return `${segment.type}:${segment.id}`
		case 'scheduler':
		case 'slice-pool':
			return segment.type
		default:
			throw new Error(`Unexpected Dispatch Coordination Scope Segment: ${String(segment satisfies never)}`)
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	const testCorePortfolioStorage = { type: 'json' as const, dataDir: '/tmp/gorchestra-test' }

	describe('Server Dispatcher', () => {
		it('does not process accepted requests until their marker is ready', async () => {
			const started: string[] = []
			const dispatcher = createServerDispatcher({
				corePortfolioStorage: testCorePortfolioStorage,
				secretEncryptionKey: Buffer.alloc(32, 1),
				runDispatchItem: (item) => {
					if (item.request.type === 'agent-run') started.push(item.request.agentRunId)
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

		it('runs same Agent Run exclusive claims serially without coalescing them', async () => {
			const started: string[] = []
			const completed: string[] = []
			const firstGate = releaseGate()
			const dispatcher = createServerDispatcher({
				corePortfolioStorage: testCorePortfolioStorage,
				secretEncryptionKey: Buffer.alloc(32, 1),
				runDispatchItem: async (item) => {
					if (item.request.type !== 'agent-run') return
					started.push(item.request.agentRunId)
					if (started.length === 1) await firstGate.promise
					completed.push(item.request.agentRunId)
				},
			})

			const first = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1'))
			const second = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1'))
			dispatcher.ready(first)
			dispatcher.ready(second)
			await waitFor(() => started.length === 1)
			expect(completed).toEqual([])

			firstGate.release()
			await waitFor(() => completed.length === 2)
			expect(started).toEqual(['agent-run-1', 'agent-run-1'])
			expect(completed).toEqual(['agent-run-1', 'agent-run-1'])
		})

		it('allows different Agent Run exclusive claims in the same Portfolio to run concurrently', async () => {
			const { completed, dispatcher, firstGate, secondGate, started } = concurrentDispatchFixture((item) => {
				if (item.request.type !== 'agent-run') throw new Error('Expected Agent Run request')
				return item.request.agentRunId
			})

			const first = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1'))
			const second = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-2'))
			dispatcher.ready(first)
			dispatcher.ready(second)
			await waitFor(() => started.length === 2)
			expect(completed).toEqual([])

			firstGate.release()
			secondGate.release()
			await waitFor(() => completed.length === 2)
			expect(started).toEqual(['agent-run-1', 'agent-run-2'])
		})

		it('scopes coordination claims by Portfolio storage namespace', async () => {
			const { completed, dispatcher, firstGate, secondGate, started } = concurrentDispatchFixture((item) => item.coreStorageNamespace)

			const first = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1'))
			const second = await dispatcher.request(agentRunDispatch('portfolio-b', 'agent-run-1'))
			dispatcher.ready(first)
			dispatcher.ready(second)
			await waitFor(() => started.length === 2)
			expect(started).toEqual(['portfolio-a', 'portfolio-b'])

			firstGate.release()
			secondGate.release()
			await waitFor(() => completed.length === 2)
		})

		it('blocks Slice child claims while a Delivery parent exclusive claim is active', async () => {
			const started: string[] = []
			const completed: string[] = []
			const firstGate = releaseGate()
			const dispatcher = createServerDispatcher({
				corePortfolioStorage: testCorePortfolioStorage,
				secretEncryptionKey: Buffer.alloc(32, 1),
				runDispatchItem: async (item) => {
					started.push(item.request.type === 'delivery-work-operation' ? item.request.operation.scope : item.request.type)
					if (started.length === 1) await firstGate.promise
					completed.push(item.request.type)
				},
			})

			const delivery = await dispatcher.request(deliveryOperationDispatch('portfolio-a', 'delivery-1'))
			const slice = await dispatcher.request(sliceOperationDispatch('portfolio-a', 'delivery-1', 'slice-1', 2))
			dispatcher.ready(delivery)
			dispatcher.ready(slice)
			await waitFor(() => started.length === 1)
			expect(started).toEqual(['delivery'])

			firstGate.release()
			await waitFor(() => completed.length === 2)
			expect(started).toEqual(['delivery', 'slice'])
		})

		it('enforces shared-capacity Slice pool claims for sibling Slice jobs', async () => {
			const started: string[] = []
			const completed: string[] = []
			const firstGate = releaseGate()
			const secondGate = releaseGate()
			const dispatcher = createServerDispatcher({
				corePortfolioStorage: testCorePortfolioStorage,
				secretEncryptionKey: Buffer.alloc(32, 1),
				runDispatchItem: async (item) => {
					if (item.request.type !== 'delivery-work-operation' || item.request.operation.scope !== 'slice') return
					started.push(item.request.operation.sliceId)
					if (item.request.operation.sliceId === 'slice-1') await firstGate.promise
					if (item.request.operation.sliceId === 'slice-2') await secondGate.promise
					completed.push(item.request.operation.sliceId)
				},
			})

			const first = await dispatcher.request(sliceOperationDispatch('portfolio-a', 'delivery-1', 'slice-1', 2))
			const second = await dispatcher.request(sliceOperationDispatch('portfolio-a', 'delivery-1', 'slice-2', 2))
			const third = await dispatcher.request(sliceOperationDispatch('portfolio-a', 'delivery-1', 'slice-3', 2))
			dispatcher.ready(first)
			dispatcher.ready(second)
			dispatcher.ready(third)
			await waitFor(() => started.length === 2)
			expect(started).toEqual(['slice-1', 'slice-2'])

			firstGate.release()
			await waitFor(() => started.length === 3)
			secondGate.release()
			await waitFor(() => completed.length === 3)
			expect(started).toEqual(['slice-1', 'slice-2', 'slice-3'])
		})

		it('prefers broader parent scopes before descendant scopes among acquirable requests', async () => {
			const started: string[] = []
			const dispatcher = createServerDispatcher({
				corePortfolioStorage: testCorePortfolioStorage,
				secretEncryptionKey: Buffer.alloc(32, 1),
				runDispatchItem: (item) => {
					started.push(item.request.type === 'delivery-work-operation' ? item.request.operation.scope : item.request.type)
					return Promise.resolve()
				},
			})

			const slice = await dispatcher.request(sliceOperationDispatch('portfolio-a', 'delivery-1', 'slice-1', 2))
			const delivery = await dispatcher.request(deliveryOperationDispatch('portfolio-a', 'delivery-1'))
			dispatcher.ready(slice)
			dispatcher.ready(delivery)
			await waitFor(() => started.length === 2)

			expect(started).toEqual(['delivery', 'slice'])
		})

		it('does not let blocked requests stall unrelated acquirable work', async () => {
			const started: string[] = []
			const firstGate = releaseGate()
			const dispatcher = createServerDispatcher({
				corePortfolioStorage: testCorePortfolioStorage,
				secretEncryptionKey: Buffer.alloc(32, 1),
				runDispatchItem: async (item) => {
					started.push(item.request.type === 'agent-run' ? item.request.agentRunId : item.request.type)
					if (started.length === 1) await firstGate.promise
				},
			})

			const first = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1'))
			const blocked = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-1'))
			const unrelated = await dispatcher.request(agentRunDispatch('portfolio-a', 'agent-run-2'))
			dispatcher.ready(first)
			dispatcher.ready(blocked)
			dispatcher.ready(unrelated)
			await waitFor(() => started.length === 2)

			expect(started).toEqual(['agent-run-1', 'agent-run-2'])
			firstGate.release()
		})

		it('ignores unknown or already readied dispatch markers', async () => {
			const started: string[] = []
			const dispatcher = createServerDispatcher({
				corePortfolioStorage: testCorePortfolioStorage,
				secretEncryptionKey: Buffer.alloc(32, 1),
				runDispatchItem: (item) => {
					if (item.request.type === 'agent-run') started.push(item.request.agentRunId)
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
			request: {
				type: 'agent-run',
				agentRunId,
				coordinationClaims: [{ scope: [{ type: 'agent-run', id: agentRunId }], mode: { type: 'exclusive' } }],
				reason: { type: 'input-appended', inputEventId: `${agentRunId}-input` },
			},
		}
	}

	function deliveryOperationDispatch(
		coreStorageNamespace: string,
		deliveryId: string,
		queuedActionId = `${deliveryId}-queued`,
	): ServerDispatchRequest {
		return {
			coreStorageNamespace,
			request: {
				type: 'delivery-work-operation',
				deliveryId,
				queuedActionId,
				operation: { scope: 'delivery', state: 'needs-artifact-validation' },
				coordinationClaims: [{ scope: [{ type: 'delivery', id: deliveryId }], mode: { type: 'exclusive' } }],
				reason: { type: 'delivery-work-operation-queued', queuedActionId },
			},
		}
	}

	function sliceOperationDispatch(
		coreStorageNamespace: string,
		deliveryId: string,
		sliceId: string,
		capacity: number,
		queuedActionId = `${sliceId}-queued`,
	): ServerDispatchRequest {
		return {
			coreStorageNamespace,
			request: {
				type: 'delivery-work-operation',
				deliveryId,
				queuedActionId,
				operation: { scope: 'slice', sliceId, state: 'needs-artifact-creation' },
				coordinationClaims: [
					{ scope: [{ type: 'delivery', id: deliveryId }, { type: 'slice-pool' }], mode: { type: 'shared-capacity', capacity } },
					{
						scope: [
							{ type: 'delivery', id: deliveryId },
							{ type: 'slice', id: sliceId },
						],
						mode: { type: 'exclusive' },
					},
				],
				reason: { type: 'delivery-work-operation-queued', queuedActionId },
			},
		}
	}

	function concurrentDispatchFixture(recordKey: (item: ServerDispatchItem) => string) {
		const firstGate = releaseGate()
		const secondGate = releaseGate()
		const started: string[] = []
		const completed: string[] = []
		const dispatcher = createServerDispatcher({
			corePortfolioStorage: testCorePortfolioStorage,
			secretEncryptionKey: Buffer.alloc(32, 1),
			runDispatchItem: async (item) => {
				const itemKey = recordKey(item)
				started.push(itemKey)
				if (started.length === 1) await firstGate.promise
				if (started.length === 2) await secondGate.promise
				completed.push(itemKey)
			},
		})
		return { completed, dispatcher, firstGate, secondGate, started }
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
}
