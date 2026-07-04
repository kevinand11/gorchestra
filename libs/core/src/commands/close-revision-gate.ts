import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
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
import { completeSingleAgentRunByPurpose } from '../utils/agent-runs'
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

export function createCloseRevisionGateCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('closeRevisionGate', closeRevisionGateInputPipe, (input, context) =>
		withAuditStampTransaction(runtime, context, (storage, stamp) => closeRevisionGate(storage, input, stamp)),
	)
}

async function closeRevisionGate(
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const gate = await getOpenRevisionGate(storage, input.revisionGateId)
	return gate.ok ? writeClosedRevisionGate(storage, gate.value, stamp) : gate
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
	storage: CoreStorage,
	gate: RevisionGate,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const revisionGate = await updateRecordValue('revision-gate', storage, gate.id, {
		closed: { type: 'closed-without-revision', closed: stamp },
	})
	return revisionGate.ok ? completeRevisionPlanningAgentRun(storage, revisionGate.value, stamp) : revisionGate
}

async function completeRevisionPlanningAgentRun(
	storage: CoreStorage,
	revisionGate: RevisionGate,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const agentRun = await completeSingleAgentRunByPurpose(
		storage,
		{ type: 'revision-planning', revisionGateId: revisionGate.id },
		{ at: stamp.at },
	)
	return agentRun.ok ? { ok: true, value: { revisionGate, agentRun: agentRun.value } } : agentRun
}

function revisionGateClosed(revisionGateId: string): CoreResult<never, RevisionGateClosedError> {
	return { ok: false, error: { type: 'revision-gate-closed', revisionGateId } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, stamp } = await import('../utils/test-helpers')

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

			const result = await command({ revisionGateId: 'revision-gate-1' }, context)

			const expectedGate = { ...revisionGate(), closed: { type: 'closed-without-revision' as const, closed: localStamp() } }
			const expectedAgentRun = { ...revisionPlanningAgentRun(), completed: { at: localStamp().at } }
			expect(result).toEqual({ ok: true, value: { revisionGate: expectedGate, agentRun: expectedAgentRun } })
			expect(options.tx.revisionGates.records.get('revision-gate-1')).toEqual(expectedGate)
			expect(options.tx.agentRuns.records.get('agent-run-1')).toEqual(expectedAgentRun)
		})

		it('closes the Revision Gate without overwriting an already completed Agent Run', async () => {
			const options = closeRevisionGateFixture()
			const previousCompletion = { at: '2026-06-10T11:30:00.000Z' }
			options.tx.agentRuns.records.get('agent-run-1')!.completed = previousCompletion
			const command = createCloseRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: 'revision-gate-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { agentRun: { completed: previousCompletion } } })
			expect(options.tx.agentRuns.records.get('agent-run-1')?.completed).toEqual(previousCompletion)
		})

		it('rejects non-open Revision Gates', async () => {
			const options = closeRevisionGateFixture()
			options.tx.revisionGates.records.get('revision-gate-1')!.closed = {
				type: 'closed-without-revision',
				closed: localStamp(),
			}
			const command = createCloseRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: 'revision-gate-1' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'revision-gate-closed', revisionGateId: 'revision-gate-1' } })
		})
	})

	function closeRevisionGateFixture() {
		const options = createTestCoreServices()
		options.tx.revisionGates.records.set('revision-gate-1', revisionGate())
		options.tx.agentRuns.records.set('agent-run-1', revisionPlanningAgentRun())
		return options
	}

	function revisionGate(): RevisionGate {
		return {
			id: 'revision-gate-1',
			scope: { type: 'delivery-artifact', deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
			reviewSurfaceId: 'review-surface-1',
			opened: stamp,
			closed: null,
		}
	}

	function revisionPlanningAgentRun(): AgentRun {
		return {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'revision-planning', revisionGateId: 'revision-gate-1' },
			profile: {
				agentRunProfileId: 'agent-run-profile-1',
				name: 'Agent Run Profile',
				modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
			},
			modelUseOverride: null,
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
	}
}
