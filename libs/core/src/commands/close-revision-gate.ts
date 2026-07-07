import { v, type PipeOutput } from 'valleyed'

import type { AgentRun } from '../domain/agent-run'
import { idPipe, type AuditStamp } from '../domain/commons'
import type { RevisionGate } from '../domain/revision'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	RevisionGateClosedError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import type { CommandContext } from './types'
import { completeAgentRunByPurposeAndAcceptSandboxRelease } from '../utils/agent-runs'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { getRequired, updateRecordValue, withAuditStampTransaction } from './utils/storage'

const closeRevisionGateInputPipe = v.object({ revisionGateId: idPipe })
export type Input = PipeOutput<typeof closeRevisionGateInputPipe>

export interface Result {
	revisionGate: RevisionGate
	agentRun: AgentRun
}

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| RevisionGateClosedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type DispatchedResult = { result: Result; dispatchMarker: string | null }

export function createCloseRevisionGateCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('closeRevisionGate', closeRevisionGateInputPipe, async (input, context) => {
		const written = await withAuditStampTransaction(runtime, context, (storage, stamp) =>
			closeRevisionGate(runtime, storage, input, stamp),
		)
		if (!written.ok) return written
		if (written.value.dispatchMarker !== null) runtime.services.dispatcher.ready(written.value.dispatchMarker)
		return { ok: true, value: written.value.result }
	})
}

async function closeRevisionGate(
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<DispatchedResult, Exclude<Error, InvalidInputError>>> {
	const gate = await getOpenRevisionGate(storage, input.revisionGateId)
	return gate.ok ? writeClosedRevisionGate(runtime, storage, gate.value, stamp) : gate
}

async function getOpenRevisionGate(
	storage: CoreStorage,
	revisionGateId: string,
): Promise<CoreResult<RevisionGate, Exclude<Error, InvalidInputError>>> {
	const gate = await getRequired('revision-gate', storage, revisionGateId)
	return gate.ok ? validateRevisionGateOpen(gate.value) : gate
}

function validateRevisionGateOpen(gate: RevisionGate): CoreResult<RevisionGate, RevisionGateClosedError> {
	return gate.closed === null ? { ok: true, value: gate } : revisionGateClosed(gate.id)
}

async function writeClosedRevisionGate(
	runtime: CoreRuntime,
	storage: CoreStorage,
	gate: RevisionGate,
	stamp: AuditStamp,
): Promise<CoreResult<DispatchedResult, Exclude<Error, InvalidInputError>>> {
	const revisionGate = await updateRecordValue('revision-gate', storage, gate.id, {
		closed: { type: 'closed-without-revision', closed: stamp },
	})
	return revisionGate.ok ? completeRevisionPlanningAgentRun(runtime, storage, revisionGate.value, stamp) : revisionGate
}

async function completeRevisionPlanningAgentRun(
	runtime: CoreRuntime,
	storage: CoreStorage,
	revisionGate: RevisionGate,
	stamp: AuditStamp,
): Promise<CoreResult<DispatchedResult, Exclude<Error, InvalidInputError>>> {
	const agentRun = await completeAgentRunByPurposeAndAcceptSandboxRelease(
		storage,
		runtime.services.dispatcher,
		{ type: 'revision-planning', revisionGateId: revisionGate.id },
		{ at: stamp.at },
	)
	return agentRun.ok
		? {
				ok: true,
				value: {
					result: { revisionGate, agentRun: agentRun.value.agentRun },
					dispatchMarker: agentRun.value.dispatchMarker,
				},
			}
		: agentRun
}

function revisionGateClosed(revisionGateId: string): CoreResult<never, RevisionGateClosedError> {
	return { ok: false, error: { type: 'revision-gate-closed', revisionGateId } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, defaultAgentRunSandboxConfig, localStamp, stamp } =
		await import('../utils/test-helpers')

	describe('closeRevisionGate command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.revisionGates.fail.get = true
			const command = createCloseRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'closeRevisionGate' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('closes an open Revision Gate and completes its revision-planning Agent Run', async () => {
			const options = closeRevisionGateFixture()
			const command = createCloseRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: '01k00000000000000000000039' }, context)

			const expectedGate = { ...revisionGate(), closed: { type: 'closed-without-revision' as const, closed: localStamp() } }
			const expectedAgentRun = { ...revisionPlanningAgentRun(), completed: { at: localStamp().at } }
			expect(result).toEqual({ ok: true, value: { revisionGate: expectedGate, agentRun: expectedAgentRun } })
			expect(options.tx.revisionGates.records.get('01k00000000000000000000039')).toEqual(expectedGate)
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')).toEqual(expectedAgentRun)
		})

		it('closes the Revision Gate without overwriting an already completed Agent Run', async () => {
			const options = closeRevisionGateFixture()
			const previousCompletion = { at: '2026-06-10T11:30:00.000Z' }
			options.tx.agentRuns.records.get('01k00000000000000000000002')!.completed = previousCompletion
			const command = createCloseRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: '01k00000000000000000000039' }, context)

			expect(result).toMatchObject({ ok: true, value: { agentRun: { completed: previousCompletion } } })
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')?.completed).toEqual(previousCompletion)
		})

		it('rejects non-open Revision Gates', async () => {
			const options = closeRevisionGateFixture()
			options.tx.revisionGates.records.get('01k00000000000000000000039')!.closed = {
				type: 'closed-without-revision',
				closed: localStamp(),
			}
			const command = createCloseRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: '01k00000000000000000000039' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'revision-gate-closed', revisionGateId: '01k00000000000000000000039' } })
		})
	})

	function closeRevisionGateFixture() {
		const options = createTestCoreServices()
		options.tx.revisionGates.records.set('01k00000000000000000000039', revisionGate())
		options.tx.agentRuns.records.set('01k00000000000000000000002', revisionPlanningAgentRun())
		return options
	}

	function revisionGate(): RevisionGate {
		return {
			id: '01k00000000000000000000039',
			scope: {
				type: 'delivery-artifact',
				deliveryId: '01k00000000000000000000008',
				deliveryArtifactId: '01k00000000000000000000010',
			},
			reviewSurfaceId: '01k00000000000000000000037',
			opened: stamp,
			closed: null,
		}
	}

	function revisionPlanningAgentRun(): AgentRun {
		return {
			id: '01k00000000000000000000002',
			agent: { type: 'model' },
			purpose: { type: 'revision-planning', revisionGateId: '01k00000000000000000000039' },
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
			sandbox: null,
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
	}
}
