import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunEvent } from '../domain/agent-run-event'
import { freeFormStringPipe, idPipe } from '../domain/commons'
import type {
	AgentRunNotActiveError,
	AgentRunPurposeMismatchError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ProposalAlreadyReviewedError,
	ProposalTypeMismatchError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import { appendAgentRunEvent } from '../utils/agent-runs'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, getRequired } from '../utils/command-storage'
import { getPendingProposalForAgentRunPurpose, proposalRejectedProjectedParts } from '../utils/proposals'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const rejectRevisionOutputInputPipe = v.object({ proposalEventId: idPipe, reason: v.nullable(freeFormStringPipe) })
export type Input = PipeOutput<typeof rejectRevisionOutputInputPipe>

export type Result = AgentRunEvent
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| ProposalAlreadyReviewedError
	| ProposalTypeMismatchError
	| AgentRunPurposeMismatchError
	| AgentRunNotActiveError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createRejectRevisionOutputCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('rejectRevisionOutput', rejectRevisionOutputInputPipe, async (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return stamp

		return runtime.transactions.run<Result, Exclude<Error, InvalidInputError>>(async ({ storage, notifications }) => {
			const proposal = await getPendingProposalForAgentRunPurpose(
				storage,
				input.proposalEventId,
				'proposed-revision-output',
				'revision-planning',
			)
			if (!proposal.ok) return proposal

			const gate = await getRequired('revision-gate', storage, proposal.value.agentRun.purpose.revisionGateId)
			if (!gate.ok) return gate
			if (gate.value.closed !== null) {
				return { ok: false, error: { type: 'agent-run-not-active', agentRunId: proposal.value.agentRun.id } }
			}

			return appendAgentRunEvent({ values: runtime.values, notifications }, storage, proposal.value.proposal.agentRunId, {
				type: 'proposal-rejected',
				proposalEventId: proposal.value.proposal.id,
				authorized: stamp.value,
				reason: input.reason,
				projectedParts: proposalRejectedProjectedParts(proposal.value.proposal.id, input.reason),
			})
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, defaultAgentRunSandboxConfig, localStamp, stamp } =
		await import('../utils/test-helpers')
	const proposalEventId = '01k00000000000000000000003'

	describe('rejectRevisionOutput command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRunEvents.fail.get = true
			const command = createRejectRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'rejectRevisionOutput' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('appends a proposal rejection for a pending Revision proposal', async () => {
			const options = proposalFixture()
			const command = createRejectRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ proposalEventId, reason: 'Needs changes.' }, context)

			expect(result).toMatchObject({
				ok: true,
				value: {
					id: '01k00000000000000000010001',
					agentRunId: '01k00000000000000000000002',
					body: { type: 'proposal-rejected', proposalEventId, reason: 'Needs changes.' },
				},
			})
			expect(result.ok ? result.value.body : null).toEqual({
				type: 'proposal-rejected',
				proposalEventId,
				authorized: localStamp(),
				reason: 'Needs changes.',
				projectedParts: [{ type: 'text', text: `Proposal ${proposalEventId} rejected. Needs changes.`, metadata: null }],
			})
		})
	})

	function proposalFixture() {
		const options = createTestCoreServices()
		options.tx.agentRuns.records.set('01k00000000000000000000002', {
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
			started: { at: stamp.at },
			completed: null,
		})
		options.tx.revisionGates.records.set('01k00000000000000000000039', {
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
		})
		options.tx.agentRunEvents.records.set(proposalEventId, {
			id: proposalEventId,
			agentRunId: '01k00000000000000000000002',
			occurred: { at: stamp.at },
			body: {
				type: 'proposed-revision-output',
				assistantMessageEventId: '01j00000000000000000000000',
				toolCallId: 'call-1',
				output: { instruction: { body: 'Revise.' }, disposition: { body: 'Because.' } },
			},
		})
		return options
	}
}
