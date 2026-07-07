import { v, type PipeInput, type PipeOutput } from 'valleyed'

import type { AgentRun } from '../domain/agent-run'
import { idPipe, type Id } from '../domain/commons'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import { sandboxRuntimeForConfig, type SandboxRuntimeResolutionError } from '../runtime/agent-runs/sandbox-runtime'
import { sandboxPipe, sandboxReleaseOutputPipe } from '../services'
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
	if (agentRun.value.sandbox.created === null || agentRun.value.sandbox.released !== null) return { ok: true, value: undefined }

	const sandboxRuntime = await sandboxRuntimeForConfig(runtime, runtime.services.storage, agentRun.value.profile.sandboxConfig)
	if (!sandboxRuntime.ok) return recordReleaseResolutionFailure(runtime, agentRunId, sandboxRuntime.error)

	let sandboxOutput: unknown
	try {
		sandboxOutput = await sandboxRuntime.value.find({ key: agentRun.value.sandbox.key })
	} catch {
		return recordReleaseFailure(runtime, agentRunId, 'Sandbox release failed.')
	}
	if (sandboxOutput === null) return recordReleased(runtime, agentRun.value, 'Agent Run sandbox was already absent.')

	const sandbox = validateCoreServiceOutput(sandboxPipe, sandboxOutput, 'sandbox', 'find')
	if (!sandbox.ok) return sandbox

	let output: unknown
	try {
		output = await sandbox.value.release()
	} catch {
		return recordReleaseFailure(runtime, agentRunId, 'Sandbox release failed.')
	}

	const release = validateCoreServiceOutput(sandboxReleaseOutputPipe, output, 'sandbox', 'release')
	return release.ok ? recordReleased(runtime, agentRun.value, release.value.summary) : release
}

async function recordReleased(
	runtime: CoreRuntime,
	agentRun: AgentRun,
	summary: string,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const released = runtimeRecord(runtime.values)
	if (!released.ok) return released

	const sandbox = { ...agentRun.sandbox, released: released.value }
	const updated = await updateRecord('agent-run', runtime.services.storage, agentRun.id, { sandbox })
	if (!updated.ok) return updated

	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRun.id, {
		type: 'agent-run-sandbox-release-completed',
		summary,
	})
	return event.ok ? { ok: true, value: undefined } : event
}

async function recordReleaseFailure(
	runtime: CoreRuntime,
	agentRunId: Id,
	summary: string,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const failed = await appendAgentRunEvent(runtime, runtime.services.storage, agentRunId, {
		type: 'agent-run-sandbox-release-failed',
		summary,
	})
	return failed.ok ? { ok: true, value: undefined } : failed
}

function recordReleaseResolutionFailure(
	runtime: CoreRuntime,
	agentRunId: Id,
	error: SandboxRuntimeResolutionError,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> | CoreResult<never, Exclude<Error, InvalidInputError>> {
	if (error.type === 'not-found' && error.resource === 'secret') {
		return recordReleaseFailure(runtime, agentRunId, 'Vercel sandbox credential Secret is missing.')
	}
	if (error.type === 'secret-not-active') {
		return recordReleaseFailure(runtime, agentRunId, 'Vercel sandbox credential Secret is not active.')
	}
	if (error.type === 'sandbox-runtime-resolution-failed') return recordReleaseFailure(runtime, agentRunId, error.summary)

	return { ok: false, error }
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

		it('releases created sandboxes idempotently', async () => {
			const releasedKeys: string[] = []
			const options = createTestCoreServices({
				sandbox: {
					kind: 'consumer-managed',
					create: ({ key }) =>
						Promise.resolve({
							key,
							runCommand: () => Promise.resolve({ exitCode: 0, summary: 'ok', stdout: null, stderr: null }),
							release: () => Promise.resolve({ summary: 'released' }),
						}),
					find: ({ key }) =>
						Promise.resolve({
							key,
							runCommand: () => Promise.resolve({ exitCode: 0, summary: 'ok', stdout: null, stderr: null }),
							release: () => {
								releasedKeys.push(key)
								return Promise.resolve({ summary: 'released' })
							},
						}),
				},
			})
			options.tx.agentRuns.records.set('01k00000000000000000000002', {
				...testModelAgentRun(),
				sandbox: {
					key: '01k00000000000000000000002',
					created: { at: '2026-06-10T12:00:00.000Z' },
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

			expect(releasedKeys).toEqual(['01k00000000000000000000002'])
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')?.sandbox.released).toEqual({
				at: '2026-06-10T12:00:00.000Z',
			})
		})
	})
}
