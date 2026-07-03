import { v, type PipeInput, type PipeOutput } from 'valleyed'

import { agentRunEventCursorPipe, agentRunEventPipe } from '../domain/agent-run'
import { idPipe, positiveIntegerPipe } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { getRequired, listRecords, withTransaction } from '../storage/helpers'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

const DEFAULT_AFTER_CURSOR = null
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export const inputPipe = v.object({
	agentRunId: idPipe,
	afterCursor: v.defaults(v.nullable(agentRunEventCursorPipe), DEFAULT_AFTER_CURSOR),
	limit: v.defaults(positiveIntegerPipe, DEFAULT_LIMIT),
})
type ParsedInput = PipeOutput<typeof inputPipe>
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>

export const resultPipe = v.array(agentRunEventPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetAgentRunEventsQuery(options: CoreServices): Operation {
	const query = buildQueryHandler('getAgentRunEvents', inputPipe, (input: ParsedInput) =>
		withTransaction(options, async (storage) => {
			const agentRun = await getRequired('agent-run', storage, input.agentRunId)
			if (!agentRun.ok) return agentRun

			return listRecords('agent-run-event', storage, {
				where: (filter, fields) =>
					input.afterCursor === null
						? filter.eq(fields.agentRunId, input.agentRunId)
						: filter.eq(fields.agentRunId, input.agentRunId).gt(fields.cursor, input.afterCursor),
				orderBy: [{ field: 'cursor', direction: 'asc' }],
				limit: Math.min(input.limit, MAX_LIMIT),
			})
		}),
	)

	return (input) => query({ afterCursor: undefined, limit: undefined, ...input })
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices } = await import('../utils/test-helpers')

	describe('getAgentRunEvents query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRuns.fail.get = true
			const query = createGetAgentRunEventsQuery(options)

			const result = await query({ agentRunId: '', afterCursor: null, limit: 1 })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getAgentRunEvents' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the target Agent Run does not exist', async () => {
			const query = createGetAgentRunEventsQuery(createTestCoreServices())

			const result = await query({ agentRunId: 'agent-run-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'agent-run', id: 'agent-run-1' } })
		})

		it('returns Agent Run Events ordered by cursor after the exclusive cursor', async () => {
			const options = createTestCoreServices()
			seedAgentRun(options)
			const second = agentRunEvent('agent-run-event-2', 2)
			const third = agentRunEvent('agent-run-event-3', 3)
			options.tx.agentRunEvents.records.set(third.id, third)
			options.tx.agentRunEvents.records.set('agent-run-event-other', {
				...agentRunEvent('agent-run-event-other', 4),
				agentRunId: 'agent-run-other',
			})
			options.tx.agentRunEvents.records.set(second.id, second)
			options.tx.agentRunEvents.records.set('agent-run-event-1', agentRunEvent('agent-run-event-1', 1))
			const query = createGetAgentRunEventsQuery(options)

			const result = await query({ agentRunId: 'agent-run-1', afterCursor: cursor(1), limit: 10 })

			expect(result).toEqual({ ok: true, value: [second, third] })
		})

		it('bounds query results with default and maximum limits', async () => {
			const defaultOptions = createTestCoreServices()
			seedAgentRun(defaultOptions)
			seedAgentRunEvents(defaultOptions, 101)
			const defaultResult = await createGetAgentRunEventsQuery(defaultOptions)({ agentRunId: 'agent-run-1' })
			expect(defaultResult).toMatchObject({ ok: true })
			expect(defaultResult.ok ? defaultResult.value.map((event) => event.cursor) : []).toEqual(range(1, 100).map(cursor))

			const maxOptions = createTestCoreServices()
			seedAgentRun(maxOptions)
			seedAgentRunEvents(maxOptions, 501)
			const maxResult = await createGetAgentRunEventsQuery(maxOptions)({ agentRunId: 'agent-run-1', limit: 999 })

			expect(maxResult).toMatchObject({ ok: true })
			expect(maxResult.ok ? maxResult.value : []).toHaveLength(500)
		})
	})

	function seedAgentRun(options: ReturnType<typeof createTestCoreServices>) {
		options.tx.agentRuns.records.set('agent-run-1', {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: 'plan-1' },
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		})
	}

	function seedAgentRunEvents(options: ReturnType<typeof createTestCoreServices>, count: number) {
		for (let sequence = 1; sequence <= count; sequence += 1) {
			const event = agentRunEvent(`agent-run-event-${sequence}`, sequence)
			options.tx.agentRunEvents.records.set(event.id, event)
		}
	}

	function range(start: number, end: number): number[] {
		return Array.from({ length: end - start + 1 }, (_, index) => start + index)
	}

	function agentRunEvent(id: string, sequence: number) {
		return {
			id,
			agentRunId: 'agent-run-1',
			cursor: cursor(sequence),
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: {
				type: 'input-message' as const,
				source: { type: 'runtime' as const },
				content: [{ type: 'text' as const, text: `event ${sequence}` }],
			},
		}
	}

	function cursor(sequence: number): string {
		return `01J000000000000000000${sequence.toString().padStart(5, '0')}`
	}
}
