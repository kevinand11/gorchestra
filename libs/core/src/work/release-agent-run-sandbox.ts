import { v, type PipeInput, type PipeOutput } from 'valleyed'

import type { WorkContext } from './types'
import type { AgentRun } from '../domain/agent-run'
import { idPipe, type Id } from '../domain/commons'
import type {
	DispatchAttemptAbortedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import { appendAgentRunEvent, updateAgentRunRecord } from '../utils/agent-runs'
import type { CoreRuntime } from '../utils/runtime'
import { managedSandboxProviderForConfig } from '../utils/runtime/sandboxes'
import type { ManagedSandboxProvider } from '../utils/runtime/sandboxes/managed'
import { runtimeRecord } from '../utils/runtime-values'
import { getRequired } from '../utils/storage/helpers'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'
import { buildWorkHandler } from '../utils/work-handler'

const inputPipe = v.object({ agentRunId: idPipe })
type ParsedInput = PipeOutput<typeof inputPipe>
type AgentRunWithSandbox = AgentRun & { sandbox: NonNullable<AgentRun['sandbox']> }
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>
export type Result = void
export type Error =
	| InvalidInputError
	| DispatchAttemptAbortedError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
export type Operation = (input: Input, context: WorkContext) => Promise<CoreResult<Result, Error>>

export function createReleaseAgentRunSandboxOperation(runtime: CoreRuntime): Operation {
	return buildWorkHandler('releaseAgentRunSandbox', inputPipe, async (input: ParsedInput, context) => {
		if (context.signal?.aborted === true) return dispatchAttemptAborted(context.correlationId ?? input.agentRunId)
		const agentRun = await getRequired('agent-run', runtime.services.storage, input.agentRunId)
		if (!agentRun.ok) return agentRun
		if (agentRun.value.sandbox === null || agentRun.value.sandbox.released !== null) return { ok: true, value: undefined }

		return reconcileSandboxRelease(runtime, { ...agentRun.value, sandbox: agentRun.value.sandbox }, context.signal)
	})
}

async function reconcileSandboxRelease(
	runtime: CoreRuntime,
	agentRun: AgentRunWithSandbox,
	signal?: AbortSignal,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const provider = await managedSandboxProviderForConfig(runtime, runtime.services.storage, agentRun.profile.sandboxConfig)
	if (!provider.ok) {
		return provider.error.type === 'sandbox-provider-resolution-failed'
			? recordReleaseFailure(runtime, agentRun.id, provider.error.summary)
			: { ok: false, error: provider.error }
	}
	if (signal?.aborted === true) return dispatchAttemptAborted(agentRun.id)
	return releaseSandboxWithProvider(runtime, provider.value, agentRun, signal)
}

async function releaseSandboxWithProvider(
	runtime: CoreRuntime,
	provider: ManagedSandboxProvider,
	agentRun: AgentRunWithSandbox,
	signal?: AbortSignal,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const sandbox = await provider.find({ key: agentRun.sandbox.key })
	if (!sandbox.ok) {
		return sandbox.error.type === 'sandbox-operation-failed'
			? recordReleaseFailure(runtime, agentRun.id, sandbox.error.summary)
			: { ok: false, error: sandbox.error }
	}
	if (sandbox.value === null) return recordReleased(runtime, agentRun, 'Agent Run sandbox was already absent.')
	if (isAborted(signal)) return dispatchAttemptAborted(agentRun.id)

	const release = await sandbox.value.release()
	if (!release.ok) {
		return release.error.type === 'sandbox-operation-failed'
			? recordReleaseFailure(runtime, agentRun.id, release.error.summary)
			: { ok: false, error: release.error }
	}
	if (isAborted(signal)) return dispatchAttemptAborted(agentRun.id)
	const confirmed = await provider.find({ key: agentRun.sandbox.key })
	if (!confirmed.ok) {
		return confirmed.error.type === 'sandbox-operation-failed'
			? recordReleaseFailure(runtime, agentRun.id, confirmed.error.summary)
			: { ok: false, error: confirmed.error }
	}
	return confirmed.value === null
		? recordReleased(runtime, agentRun, release.value.summary)
		: recordReleaseFailure(runtime, agentRun.id, 'Agent Run sandbox remained present after release.')
}

function isAborted(signal?: AbortSignal): boolean {
	return signal?.aborted === true
}

function dispatchAttemptAborted(requestId: Id): CoreResult<never, DispatchAttemptAbortedError> {
	return { ok: false, error: { type: 'dispatch-attempt-aborted', requestId, attemptNumber: 0 } }
}

async function recordReleased(
	runtime: CoreRuntime,
	agentRun: AgentRunWithSandbox,
	summary: string,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const released = runtimeRecord(runtime.values)
	if (!released.ok) return released

	const sandbox = { ...agentRun.sandbox, released: released.value }
	return runtime.transactions.run(async ({ storage, notifications }) => {
		const updated = await updateAgentRunRecord(storage, notifications, agentRun.id, { sandbox })
		if (!updated.ok) return updated

		const event = await appendAgentRunEvent({ values: runtime.values, notifications }, storage, agentRun.id, {
			type: 'agent-run-sandbox-release-completed',
			summary,
		})
		return event.ok ? { ok: true, value: undefined } : event
	})
}

async function recordReleaseFailure(
	runtime: CoreRuntime,
	agentRunId: Id,
	summary: string,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	return runtime.transactions.run(async ({ storage, notifications }) => {
		const failed = await appendAgentRunEvent({ values: runtime.values, notifications }, storage, agentRunId, {
			type: 'agent-run-sandbox-release-failed',
			summary,
		})
		return failed.ok ? { ok: true, value: undefined } : failed
	})
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
			const notificationTypes: string[] = []
			const files = new Map<string, string>()
			let released = false
			const options = createTestCoreServices({
				notifications: { publish: (notification) => notificationTypes.push(notification.data.type) },
				sandbox: {
					kind: 'consumer-managed',
					create: () => Promise.resolve(rawSandbox(files, () => Promise.resolve({ summary: 'released' }))),
					find: ({ key }) =>
						released
							? Promise.resolve(null)
							: Promise.resolve(
									rawSandbox(files, () => {
										released = true
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
			expect(notificationTypes).toEqual(['agent-run-updated', 'agent-run-event-created'])
		})

		it('records release completion when runtime env wipe fails but raw release succeeds', async () => {
			let released = false
			const options = createTestCoreServices({
				sandbox: {
					kind: 'consumer-managed',
					create: () => Promise.resolve(rawSandbox(new Map(), () => Promise.resolve({ summary: 'released' }))),
					find: () =>
						released
							? Promise.resolve(null)
							: Promise.resolve(
									testRawSandbox({
										writeFile: () => Promise.reject(new Error('no write')),
										release: () => {
											released = true
											return Promise.resolve({ summary: 'released' })
										},
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
