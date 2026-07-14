import type { InvalidCoreServiceOutputError, InvariantViolationError, StorageOperationFailedError } from '../errors'
import type { CoreRuntime } from '../utils/runtime'
import { runtimeRecord } from '../utils/runtime-values'
import { deleteRecords, listRecords } from '../utils/storage/helpers'
import type { Result } from '../utils/types'

export type DispatchPruneError = InvalidCoreServiceOutputError | StorageOperationFailedError | InvariantViolationError

export function pruneCompletedDispatchRequests(
	runtime: CoreRuntime,
	input: { completedRetentionMs: number; pruneBatchSize: number },
): Promise<Result<number, DispatchPruneError>> {
	return runtime.transactions.run<number, DispatchPruneError>(async ({ storage }) => {
		const now = runtimeRecord(runtime.values)
		if (!now.ok) return now
		const cutoff = Date.parse(now.value.at) - input.completedRetentionMs
		const requests = await listRecords('dispatch-request', storage)
		if (!requests.ok) return requests
		const ids = requests.value
			.filter((request) => request.lifecycle.type === 'completed' && Date.parse(request.lifecycle.completed.at) < cutoff)
			.sort((left, right) => {
				if (left.lifecycle.type !== 'completed' || right.lifecycle.type !== 'completed') return 0
				return left.lifecycle.completed.at.localeCompare(right.lifecycle.completed.at) || left.id.localeCompare(right.id)
			})
			.slice(0, input.pruneBatchSize)
			.map((request) => request.id)
		return deleteRecords('dispatch-request', storage, ids)
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, seedDispatchRequest, testId } = await import('../utils/test-helpers')

	describe('completed Dispatch Request pruning', () => {
		it('deletes only completed requests older than retention in bounded batches', async () => {
			const options = createTestCoreServices()
			for (let sequence = 1; sequence <= 3; sequence += 1) {
				seedDispatchRequest(options.tx, testId(90 + sequence), {
					lifecycle: {
						type: 'completed',
						completed: { at: '2026-06-08T12:00:00.000Z' },
						outcome: 'processed',
					},
				})
			}
			const recent = seedDispatchRequest(options.tx, testId(95), {
				lifecycle: {
					type: 'completed',
					completed: { at: '2026-06-10T11:30:00.000Z' },
					outcome: 'processed',
				},
			})
			const pending = seedDispatchRequest(options.tx, testId(96))
			const failed = seedDispatchRequest(options.tx, testId(97), {
				lifecycle: {
					type: 'failed',
					failed: { at: '2026-06-08T12:00:00.000Z' },
					failure: { category: 'handler-error', summary: 'Failed.' },
				},
			})

			const result = await pruneCompletedDispatchRequests(createTestCoreRuntime(options), {
				completedRetentionMs: 24 * 60 * 60 * 1_000,
				pruneBatchSize: 2,
			})

			expect(result).toEqual({ ok: true, value: 2 })
			expect(options.tx.dispatchRequests.records).toHaveLength(4)
			expect(options.tx.dispatchRequests.records.has(recent.id)).toBe(true)
			expect(options.tx.dispatchRequests.records.has(pending.id)).toBe(true)
			expect(options.tx.dispatchRequests.records.has(failed.id)).toBe(true)
		})
	})
}
