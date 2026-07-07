import { v, type PipeInput, type PipeOutput } from 'valleyed'

import { agentRunEventPipe } from '../domain/agent-run'
import { idPipe, paginatedQueryEnvelopePipe, paginatedQueryInputPipe } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { getRequired, listRecordsPaginated, withTransaction } from '../storage/helpers'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.merge(v.object({ agentRunId: idPipe }), paginatedQueryInputPipe)
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>

export const resultPipe = paginatedQueryEnvelopePipe(agentRunEventPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListAgentRunEventsQuery(options: CoreServices): Operation {
	return buildQueryHandler('listAgentRunEvents', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const agentRun = await getRequired('agent-run', storage, input.agentRunId)
			if (!agentRun.ok) return agentRun

			return listRecordsPaginated('agent-run-event', storage, input, {
				where: (filter, fields) => filter.eq(fields.agentRunId, input.agentRunId),
			})
		}),
	) as Operation
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, defaultAgentRunSandboxConfig } = await import('../utils/test-helpers')

	describe('listAgentRunEvents query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRuns.fail.get = true
			const query = createListAgentRunEventsQuery(options)

			const result = await query({ agentRunId: '', limit: 1 })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listAgentRunEvents' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the target Agent Run does not exist', async () => {
			const query = createListAgentRunEventsQuery(createTestCoreServices())

			const result = await query({ agentRunId: '01k00000000000000000000002' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'agent-run', id: '01k00000000000000000000002' } })
		})

		it('returns Agent Run Events ordered by id before the exclusive id', async () => {
			const options = createTestCoreServices()
			seedAgentRun(options)
			const second = agentRunEvent('01k00000000000000000000004', 2)
			const third = agentRunEvent('01k00000000000000000000005', 3)
			options.tx.agentRunEvents.records.set(third.id, third)
			options.tx.agentRunEvents.records.set('01k00000000000000000001000', {
				...agentRunEvent('01k00000000000000000001000', 4),
				agentRunId: '01k00000000000000000001001',
			})
			options.tx.agentRunEvents.records.set(second.id, second)
			options.tx.agentRunEvents.records.set('01k00000000000000000000003', agentRunEvent('01k00000000000000000000003', 1))
			const query = createListAgentRunEventsQuery(options)

			const result = await query({ agentRunId: '01k00000000000000000000002', beforeId: '01k00000000000000000000006', limit: 10 })

			expect(result).toEqual({
				ok: true,
				value: {
					items: [third, second, agentRunEvent('01k00000000000000000000003', 1)],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 10, total: 3, count: 3 },
				},
			})
		})

		it('returns all matching events when no limit is provided', async () => {
			const options = createTestCoreServices()
			seedAgentRun(options)
			seedAgentRunEvents(options, 101)

			const result = await createListAgentRunEventsQuery(options)({ agentRunId: '01k00000000000000000000002' })

			expect(result).toMatchObject({ ok: true })
			expect(result.ok ? result.value.items.map((event) => event.id) : []).toEqual(rangeDesc(101, 1).map(cursor))
		})
	})

	function seedAgentRun(options: ReturnType<typeof createTestCoreServices>) {
		options.tx.agentRuns.records.set('01k00000000000000000000002', {
			id: '01k00000000000000000000002',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: '01k00000000000000000000028' },
			profile: {
				agentRunProfileId: '01k00000000000000000000006',
				name: 'Agent Run Profile',
				modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
				runtimeRequirements: [],
				sandboxConfig: defaultAgentRunSandboxConfig(),
			},
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: null,
			sandbox: {
				key: '01k00000000000000000000002',
				created: null,
				appliedRequirements: [],
				appliedThroughEventId: null,
				released: null,
			},
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		})
	}

	function seedAgentRunEvents(options: ReturnType<typeof createTestCoreServices>, count: number) {
		for (let sequence = 1; sequence <= count; sequence += 1) {
			const event = agentRunEvent(cursor(sequence), sequence)
			options.tx.agentRunEvents.records.set(event.id, event)
		}
	}

	function rangeDesc(start: number, end: number): number[] {
		return Array.from({ length: start - end + 1 }, (_, index) => start - index)
	}

	function agentRunEvent(id: string, sequence: number) {
		return {
			id,
			agentRunId: '01k00000000000000000000002',
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: {
				type: 'input-message' as const,
				source: { type: 'runtime' as const },
				parts: [{ type: 'text' as const, text: `event ${sequence}`, metadata: null }],
			},
		}
	}

	function cursor(sequence: number): string {
		return `01j000000000000000000${sequence.toString().padStart(5, '0')}`
	}
}
