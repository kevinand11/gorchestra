import { v, type PipeInput, type PipeOutput } from 'valleyed'

import { paginatedQueryEnvelopePipe, paginatedQueryInputPipe } from '../domain/commons'
import { dispatchLifecycleTypePipe, dispatchRequestPipe, dispatchRequestTypePipe } from '../domain/dispatch-request'
import type { InvalidCoreServiceOutputError, InvalidInputError, StorageOperationFailedError } from '../errors'
import { buildQueryHandler } from '../utils/query-handler'
import { listRecordsPaginated } from '../utils/storage/helpers'
import type { CoreTransactions } from '../utils/transactions'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'

export const inputPipe = v.merge(
	paginatedQueryInputPipe,
	v.object({
		requestType: v.optional(dispatchRequestTypePipe),
		lifecycleType: v.optional(dispatchLifecycleTypePipe),
	}),
)
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>

export const resultPipe = paginatedQueryEnvelopePipe(dispatchRequestPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListDispatchRequestsQuery(transactions: CoreTransactions): Operation {
	return buildQueryHandler('listDispatchRequests', inputPipe, (input) =>
		transactions.run(({ storage }) =>
			listRecordsPaginated('dispatch-request', storage, input, {
				where: (filter, fields) => {
					let scoped = filter
					if (input.requestType !== undefined) {
						scoped = scoped.eq(fields.payload.nested('type', 'string'), input.requestType)
					}
					if (input.lifecycleType !== undefined) {
						scoped = scoped.eq(fields.lifecycle.nested('type', 'string'), input.lifecycleType)
					}
					return scoped
				},
			}),
		),
	) as Operation
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedDispatchRequest, testId } = await import('../utils/test-helpers')

	describe('listDispatchRequests query', () => {
		it('validates filters before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.dispatchRequests.fail.list = true

			const result = await createListDispatchRequestsQuery(options.transactions)({ requestType: 'unknown' } as never)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listDispatchRequests' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('filters full lifecycle records and orders them by id descending', async () => {
			const options = createTestCoreServices()
			seedDispatchRequest(options.tx, testId(90), {
				payload: { type: 'agent-run-model-turn', agentRunId: testId(2) },
				reasons: [{ type: 'input-appended', inputEventId: testId(3) }],
				deduplicationKey: null,
				coordinationClaims: [{ scope: [{ type: 'agent-run', id: testId(2) }], mode: { type: 'exclusive' } }],
			})
			const matching = seedDispatchRequest(options.tx, testId(91), {
				payload: { type: 'agent-run-preparation', agentRunId: testId(2) },
				reasons: [{ type: 'agent-run-created' }],
				deduplicationKey: { type: 'agent-run-preparation', agentRunId: testId(2) },
				coordinationClaims: [{ scope: [{ type: 'agent-run', id: testId(2) }], mode: { type: 'exclusive' } }],
			})
			seedDispatchRequest(options.tx, testId(92), {
				payload: { type: 'agent-run-preparation', agentRunId: testId(4) },
				reasons: [{ type: 'agent-run-created' }],
				deduplicationKey: { type: 'agent-run-preparation', agentRunId: testId(4) },
				coordinationClaims: [{ scope: [{ type: 'agent-run', id: testId(4) }], mode: { type: 'exclusive' } }],
				lifecycle: {
					type: 'completed',
					completed: { at: '2026-06-10T12:00:00.000Z' },
					outcome: 'processed',
				},
			})

			const result = await createListDispatchRequestsQuery(options.transactions)({
				requestType: 'agent-run-preparation',
				lifecycleType: 'pending',
				limit: 10,
			})

			expect(result).toMatchObject({ ok: true, value: { items: [matching] } })
		})
	})
}
