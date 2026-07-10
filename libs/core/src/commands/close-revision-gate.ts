import { v, type PipeOutput } from 'valleyed'

import type { AgentRun } from '../domain/agent-run'
import { idPipe } from '../domain/commons'
import type { RevisionGate } from '../domain/revision-gate'
import type {
	AgentRunTurnActiveError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	RevisionGateClosedError,
	StorageOperationFailedError,
} from '../errors'
import type { CommandContext } from './types'
import { completeAgentRunByIdAndAcceptSandboxRelease, requireAgentRunIdle } from '../utils/agent-runs'
import { buildCommandHandler } from '../utils/command-handler'
import { getRequired, updateRecordValue, withAuditStampTransaction } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const closeRevisionGateInputPipe = v.object({ revisionGateId: idPipe })
export type Input = PipeOutput<typeof closeRevisionGateInputPipe>

export type Result = RevisionGate

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| RevisionGateClosedError
	| AgentRunTurnActiveError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type DispatchedResult = { result: Result; dispatchMarker: string | null }

export function createCloseRevisionGateCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('closeRevisionGate', closeRevisionGateInputPipe, async (input, context) => {
		const written = await withAuditStampTransaction<DispatchedResult, Exclude<Error, InvalidInputError>>(
			runtime,
			context,
			async (storage, stamp) => {
				const gate = await getRequired('revision-gate', storage, input.revisionGateId)
				if (!gate.ok) return gate
				if (gate.value.closed !== null) {
					return { ok: false, error: { type: 'revision-gate-closed', revisionGateId: gate.value.id } }
				}

				const idle = await requireAgentRunIdle(storage, gate.value.agentRunId)
				if (!idle.ok) return idle

				const revisionGate = await updateRecordValue('revision-gate', storage, gate.value.id, {
					closed: { type: 'closed-without-revision', closed: stamp },
				})
				if (!revisionGate.ok) return revisionGate

				const agentRun = await completeAgentRunByIdAndAcceptSandboxRelease(
					storage,
					runtime.services.dispatcher,
					revisionGate.value.agentRunId,
					{ at: stamp.at },
				)
				return agentRun.ok
					? { ok: true, value: { result: revisionGate.value, dispatchMarker: agentRun.value.dispatchMarker } }
					: agentRun
			},
		)
		if (!written.ok) return written
		if (written.value.dispatchMarker !== null) runtime.services.dispatcher.ready(written.value.dispatchMarker)
		return { ok: true, value: written.value.result }
	})
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
			expect(result).toEqual({ ok: true, value: expectedGate })
			expect(options.tx.revisionGates.records.get('01k00000000000000000000039')).toEqual(expectedGate)
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')).toEqual(expectedAgentRun)
		})

		it('closes the Revision Gate without overwriting an already completed Agent Run', async () => {
			const options = closeRevisionGateFixture()
			const previousCompletion = { at: '2026-06-10T11:30:00.000Z' }
			options.tx.agentRuns.records.get('01k00000000000000000000002')!.completed = previousCompletion
			const command = createCloseRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: '01k00000000000000000000039' }, context)

			expect(result).toEqual({
				ok: true,
				value: { ...revisionGate(), closed: { type: 'closed-without-revision', closed: localStamp() } },
			})
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

		it('rejects Revision Gates whose Revision Planning Agent Run has an unmatched active turn', async () => {
			const options = closeRevisionGateFixture()
			options.tx.agentRunEvents.records.set('turn-started', {
				id: 'turn-started',
				agentRunId: '01k00000000000000000000002',
				occurred: { at: '2026-06-10T12:00:00.000Z' },
				body: {
					type: 'turn-started',
					contextThroughEventId: '01j00000000000000000000000',
					reason: { type: 'input', inputEventIds: ['01j00000000000000000000000'] },
				},
			})
			const command = createCloseRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: '01k00000000000000000000039' }, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'agent-run-turn-active', agentRunId: '01k00000000000000000000002', turnStartedEventId: 'turn-started' },
			})
			expect(options.tx.revisionGates.records.get('01k00000000000000000000039')?.closed).toBeNull()
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
			agentRunId: '01k00000000000000000000002',
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
