import type { WorkspaceMutationKind } from './registry'

type CoordinatedExecution<T> =
	| { workspaceMutationKind: Extract<WorkspaceMutationKind, 'read-only'>; execute: () => Promise<T> }
	| { workspaceMutationKind: Extract<WorkspaceMutationKind, 'file-mutator'>; mutationKey: string; execute: () => Promise<T> }
	| { workspaceMutationKind: Extract<WorkspaceMutationKind, 'global-mutator'>; execute: () => Promise<T> }

export class AgentRunToolExecutionCoordinator {
	readonly #fileQueuesByMutationKey = new Map<string, Promise<void>>()
	#globalQueue: Promise<void> = Promise.resolve()

	run<T>(input: CoordinatedExecution<T>): Promise<T> {
		switch (input.workspaceMutationKind) {
			case 'read-only':
				return input.execute()
			case 'file-mutator':
				return this.runFileMutator(input.mutationKey, input.execute)
			case 'global-mutator':
				return this.runGlobalMutator(input.execute)
			default:
				throw new Error(`Unexpected workspace mutation kind: ${String(input satisfies never)}`)
		}
	}

	private runFileMutator<T>(mutationKey: string, execute: () => Promise<T>): Promise<T> {
		const previousFileWork = this.#fileQueuesByMutationKey.get(mutationKey) ?? Promise.resolve()
		const previousGlobalWork = this.#globalQueue
		const result = Promise.all([previousFileWork, previousGlobalWork]).then(() => execute())
		const completion = result.then(ignoreFulfilled, ignoreRejected)
		this.#fileQueuesByMutationKey.set(mutationKey, completion)
		void completion.then(() => {
			if (this.#fileQueuesByMutationKey.get(mutationKey) === completion) this.#fileQueuesByMutationKey.delete(mutationKey)
		})
		return result
	}

	private runGlobalMutator<T>(execute: () => Promise<T>): Promise<T> {
		const previousGlobalWork = this.#globalQueue
		const previousFileWork = [...this.#fileQueuesByMutationKey.values()]
		const result = Promise.all([previousGlobalWork, ...previousFileWork]).then(() => execute())
		this.#globalQueue = result.then(ignoreFulfilled, ignoreRejected)
		return result
	}
}

function ignoreFulfilled(): void {}
function ignoreRejected(): void {}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('AgentRunToolExecutionCoordinator', () => {
		it('runs read-only tools immediately while file mutations are queued', async () => {
			const coordinator = new AgentRunToolExecutionCoordinator()
			const events: string[] = []
			const releaseFile = deferred<void>()

			const file = coordinator.run({
				workspaceMutationKind: 'file-mutator',
				mutationKey: '/workspace/a.txt',
				execute: async () => {
					events.push('file-start')
					await releaseFile.promise
					events.push('file-end')
				},
			})
			await flushCoordinatorQueue()
			const read = coordinator.run({
				workspaceMutationKind: 'read-only',
				execute: () => {
					events.push('read')
					return Promise.resolve()
				},
			})

			expect(events).toEqual(['file-start', 'read'])
			releaseFile.resolve()
			await Promise.all([file, read])
			expect(events).toEqual(['file-start', 'read', 'file-end'])
		})

		it('queues file mutators by mutation key without blocking unrelated files', async () => {
			const coordinator = new AgentRunToolExecutionCoordinator()
			const events: string[] = []
			const releaseFirst = deferred<void>()

			const first = coordinator.run({
				workspaceMutationKind: 'file-mutator',
				mutationKey: '/workspace/a.txt',
				execute: async () => {
					events.push('a1-start')
					await releaseFirst.promise
					events.push('a1-end')
				},
			})
			const second = coordinator.run({
				workspaceMutationKind: 'file-mutator',
				mutationKey: '/workspace/a.txt',
				execute: () => {
					events.push('a2')
					return Promise.resolve()
				},
			})
			const other = coordinator.run({
				workspaceMutationKind: 'file-mutator',
				mutationKey: '/workspace/b.txt',
				execute: () => {
					events.push('b')
					return Promise.resolve()
				},
			})

			await flushCoordinatorQueue()
			expect(events).toEqual(['a1-start', 'b'])
			releaseFirst.resolve()
			await Promise.all([first, second, other])
			expect(events).toEqual(['a1-start', 'b', 'a1-end', 'a2'])
		})

		it('runs global mutators after existing file mutators and before later file mutators', async () => {
			const coordinator = new AgentRunToolExecutionCoordinator()
			const events: string[] = []
			const releaseFile = deferred<void>()

			const firstFile = coordinator.run({
				workspaceMutationKind: 'file-mutator',
				mutationKey: '/workspace/a.txt',
				execute: async () => {
					events.push('file-1-start')
					await releaseFile.promise
					events.push('file-1-end')
				},
			})
			const global = coordinator.run({
				workspaceMutationKind: 'global-mutator',
				execute: () => {
					events.push('global')
					return Promise.resolve()
				},
			})
			const laterFile = coordinator.run({
				workspaceMutationKind: 'file-mutator',
				mutationKey: '/workspace/b.txt',
				execute: () => {
					events.push('file-2')
					return Promise.resolve()
				},
			})

			await flushCoordinatorQueue()
			expect(events).toEqual(['file-1-start'])
			releaseFile.resolve()
			await Promise.all([firstFile, global, laterFile])
			expect(events).toEqual(['file-1-start', 'file-1-end', 'global', 'file-2'])
		})
	})

	async function flushCoordinatorQueue() {
		await Promise.resolve()
		await Promise.resolve()
	}

	function deferred<T>() {
		let resolve!: (value: T | PromiseLike<T>) => void
		const promise = new Promise<T>((resolver) => {
			resolve = resolver
		})
		return { promise, resolve }
	}
}
