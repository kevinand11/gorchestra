import { v, type PipeInput, type PipeOutput } from 'valleyed'

import type { WorkContext } from './types'
import { buildWorkHandler } from './utils/handler'
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
import { managedSandboxProviderForConfig, type SandboxProviderResolutionError } from '../runtime/sandboxes'
import { getRequired, updateRecord } from '../storage/helpers'
import { appendAgentRunEvent } from '../utils/agent-runs'
import { runtimeRecord } from '../utils/runtime-values'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'

const inputPipe = v.object({ agentRunId: idPipe })
type ParsedInput = PipeOutput<typeof inputPipe>
type AgentRunWithSandbox = AgentRun & { sandbox: NonNullable<AgentRun['sandbox']> }
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

async function releaseAgentRunSandbox(runtime: CoreRuntime, agentRunId: Id): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const agentRun = await getRequired('agent-run', runtime.services.storage, agentRunId)
	if (!agentRun.ok) return agentRun
	if (agentRun.value.sandbox === null || agentRun.value.sandbox.released !== null) return { ok: true, value: undefined }

	const releasableAgentRun: AgentRunWithSandbox = { ...agentRun.value, sandbox: agentRun.value.sandbox }
	const provider = await managedSandboxProviderForConfig(runtime, runtime.services.storage, releasableAgentRun.profile.sandboxConfig)
	if (!provider.ok) return recordReleaseResolutionFailure(runtime, agentRunId, provider.error)

	const sandbox = await provider.value.find({ key: releasableAgentRun.sandbox.key })
	if (!sandbox.ok) {
		return sandbox.error.type === 'sandbox-operation-failed'
			? recordReleaseFailure(runtime, agentRunId, sandbox.error.summary)
			: { ok: false, error: sandbox.error }
	}
	if (sandbox.value === null) return recordReleased(runtime, releasableAgentRun, 'Agent Run sandbox was already absent.')

	const release = await sandbox.value.release()
	if (!release.ok) {
		return release.error.type === 'sandbox-operation-failed'
			? recordReleaseFailure(runtime, agentRunId, release.error.summary)
			: { ok: false, error: release.error }
	}
	return recordReleased(runtime, releasableAgentRun, release.value.summary)
}

async function recordReleased(
	runtime: CoreRuntime,
	agentRun: AgentRunWithSandbox,
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
	error: SandboxProviderResolutionError,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> | CoreResult<never, Exclude<Error, InvalidInputError>> {
	return error.type === 'sandbox-provider-resolution-failed'
		? recordReleaseFailure(runtime, agentRunId, error.summary)
		: { ok: false, error }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, testModelAgentRun, testRawSandbox } = await import('../utils/test-helpers')

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

		it('releases created sandboxes idempotently and wipes runtime env before raw release', async () => {
			const releasedKeys: string[] = []
			const files = new Map<string, string>()
			const options = createTestCoreServices({
				sandbox: {
					kind: 'consumer-managed',
					create: () => Promise.resolve(rawSandbox(files, () => Promise.resolve({ summary: 'released' }))),
					find: ({ key }) =>
						Promise.resolve(
							rawSandbox(files, () => {
								releasedKeys.push(key)
								return Promise.resolve({ summary: 'released' })
							}),
						),
				},
			})
			seedCreatedAgentRun(options)
			const operation = createReleaseAgentRunSandboxOperation(createTestCoreRuntime(options))

			await expect(operation({ agentRunId: '01k00000000000000000000002' }, { correlationId: null })).resolves.toEqual({
				ok: true,
				value: undefined,
			})
			await expect(operation({ agentRunId: '01k00000000000000000000002' }, { correlationId: null })).resolves.toEqual({
				ok: true,
				value: undefined,
			})

			expect(files.get('/workspace/.gorchestra/runtime-env.json')).toBe('{}\n')
			expect(releasedKeys).toEqual(['01k00000000000000000000002'])
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')?.sandbox?.released).toEqual({
				at: '2026-06-10T12:00:00.000Z',
			})
		})

		it('records release completion when runtime env wipe fails but raw release succeeds', async () => {
			const options = createTestCoreServices({
				sandbox: {
					kind: 'consumer-managed',
					create: () => Promise.resolve(rawSandbox(new Map(), () => Promise.resolve({ summary: 'released' }))),
					find: () =>
						Promise.resolve(
							testRawSandbox({
								writeFile: () => Promise.reject(new Error('no write')),
								release: () => Promise.resolve({ summary: 'released' }),
							}),
						),
				},
			})
			seedCreatedAgentRun(options)
			const operation = createReleaseAgentRunSandboxOperation(createTestCoreRuntime(options))

			await expect(operation({ agentRunId: '01k00000000000000000000002' }, { correlationId: null })).resolves.toEqual({
				ok: true,
				value: undefined,
			})
			expect(Array.from(options.tx.agentRunEvents.records.values()).at(-1)?.body).toMatchObject({
				type: 'agent-run-sandbox-release-completed',
				summary: 'released',
			})
		})
	})

	function seedCreatedAgentRun(options: ReturnType<typeof createTestCoreServices>): void {
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
	}

	function rawSandbox(files: Map<string, string>, release: () => Promise<{ summary: string }>) {
		return testRawSandbox({ files, release })
	}
}
