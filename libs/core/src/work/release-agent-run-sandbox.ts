import { v, type PipeInput, type PipeOutput } from 'valleyed'

import { idPipe, type Id } from '../domain/commons'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import { sandboxReleaseOutputPipe } from '../services'
import { getRequired, updateRecord } from '../storage/helpers'
import { appendAgentRunEvent } from '../utils/agent-run-events'
import { runtimeRecord } from '../utils/runtime-values'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'
import { validateCoreServiceOutput } from '../validation'
import type { WorkContext } from './types'
import { buildWorkHandler } from './utils/handler'

const inputPipe = v.object({ agentRunId: idPipe })
type ParsedInput = PipeOutput<typeof inputPipe>
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>
export type Result = void
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
export type Operation = (input: Input, context: WorkContext) => Promise<CoreResult<Result, Error>>

export function createReleaseAgentRunSandboxOperation(runtime: CoreRuntime): Operation {
	return buildWorkHandler('releaseAgentRunSandbox', inputPipe, (input: ParsedInput) => releaseAgentRunSandbox(runtime, input.agentRunId))
}

export async function releaseAgentRunSandbox(
	runtime: CoreRuntime,
	agentRunId: Id,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const agentRun = await getRequired('agent-run', runtime.services.storage, agentRunId)
	if (!agentRun.ok) return agentRun
	if (agentRun.value.sandbox.assignment === null || agentRun.value.sandbox.released !== null) return { ok: true, value: undefined }

	let output: unknown
	try {
		output = await runtime.services.sandbox.release({ ref: agentRun.value.sandbox.assignment.ref })
	} catch {
		const failed = await appendAgentRunEvent(runtime, runtime.services.storage, agentRunId, {
			type: 'agent-run-sandbox-release-failed',
			summary: 'Sandbox release failed.',
		})
		return failed.ok ? { ok: true, value: undefined } : failed
	}

	const release = validateCoreServiceOutput(sandboxReleaseOutputPipe, output, 'sandbox', 'release')
	if (!release.ok) return release

	const released = runtimeRecord(runtime.values)
	if (!released.ok) return released

	const sandbox = { ...agentRun.value.sandbox, released: released.value }
	const updated = await updateRecord('agent-run', runtime.services.storage, agentRunId, { sandbox })
	if (!updated.ok) return updated

	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRunId, {
		type: 'agent-run-sandbox-release-completed',
		summary: release.value.summary,
	})
	return event.ok ? { ok: true, value: undefined } : event
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, testModelAgentRun } = await import('../utils/test-helpers')

	describe('releaseAgentRunSandbox work operation', () => {
		it('validates input with the work boundary before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRuns.fail.get = true
			const operation = createReleaseAgentRunSandboxOperation(createTestCoreRuntime(options))

			const result = await operation({ agentRunId: '' }, { correlationId: null })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'work', operation: 'releaseAgentRunSandbox' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('releases assigned sandboxes idempotently', async () => {
			const releasedRefs: string[] = []
			const options = createTestCoreServices({
				sandbox: {
					preflight: () => Promise.resolve({ ok: true }),
					assign: () => Promise.resolve({ ref: 'sandbox-ref' }),
					runCommand: () => Promise.resolve({ exitCode: 0, summary: 'ok', stdout: null, stderr: null }),
					release: (input) => {
						releasedRefs.push(input.ref)
						return Promise.resolve({ summary: 'released' })
					},
				},
			})
			options.tx.agentRuns.records.set('01k00000000000000000000002', {
				...testModelAgentRun(),
				sandbox: {
					assignment: { ref: 'sandbox-ref', assigned: { at: '2026-06-10T12:00:00.000Z' } },
					appliedRequirements: [],
					appliedThroughEventId: null,
					released: null,
				},
			})
			const operation = createReleaseAgentRunSandboxOperation(createTestCoreRuntime(options))

			await expect(operation({ agentRunId: '01k00000000000000000000002' }, { correlationId: null })).resolves.toEqual({
				ok: true,
				value: undefined,
			})
			await expect(operation({ agentRunId: '01k00000000000000000000002' }, { correlationId: null })).resolves.toEqual({
				ok: true,
				value: undefined,
			})

			expect(releasedRefs).toEqual(['sandbox-ref'])
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')?.sandbox.released).toEqual({
				at: '2026-06-10T12:00:00.000Z',
			})
		})
	})
}
