import { v, type PipeOutput } from 'valleyed'

import { agentRunPipe } from '../domain/agent-run'
import { idPipe } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import { buildQueryHandler } from '../utils/query-handler'
import { getRequired } from '../utils/storage/helpers'
import type { CoreTransactions } from '../utils/transactions'
import type { Result as CoreResult } from '../utils/types'

export const inputPipe = v.object({ agentRunId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = agentRunPipe
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetAgentRunQuery(transactions: CoreTransactions): Operation {
	return buildQueryHandler('getAgentRun', inputPipe, (input) =>
		transactions.run(({ storage }) => getRequired('agent-run', storage, input.agentRunId)),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, defaultAgentRunSandboxConfig } = await import('../utils/test-helpers')

	describe('getAgentRun query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRuns.fail.get = true
			const query = createGetAgentRunQuery(createTestCoreRuntime(options).transactions)

			const result = await query({ agentRunId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getAgentRun' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the target Agent Run does not exist', async () => {
			const query = createGetAgentRunQuery(createTestCoreRuntime().transactions)

			const result = await query({ agentRunId: '01k00000000000000000000002' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'agent-run', id: '01k00000000000000000000002' } })
		})

		it('returns the Agent Run by id without validating its purpose target', async () => {
			const options = createTestCoreServices()
			const run = agentRun()
			options.tx.agentRuns.records.set(run.id, run)
			options.tx.plans.fail.get = true
			const query = createGetAgentRunQuery(createTestCoreRuntime(options).transactions)

			const result = await query({ agentRunId: run.id })

			expect(result).toEqual({ ok: true, value: run })
		})
	})

	function agentRun() {
		return {
			id: '01k00000000000000000000002',
			agent: { type: 'model' as const },
			purpose: { type: 'planning' as const, planId: '01k00000000000000000000028' },
			profile: {
				agentRunProfileId: '01k00000000000000000000006',
				name: 'Agent Run Profile',
				modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' as const },
				runtimeRequirements: [],
				sandboxConfig: defaultAgentRunSandboxConfig(),
			},
			toolSet: [],
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: null,
			sandbox: null,
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
	}
}
