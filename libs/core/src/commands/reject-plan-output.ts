import { v, type PipeOutput } from 'valleyed'

import type { AgentRunEvent } from '../domain/agent-run-event'
import { freeFormStringPipe, idPipe } from '../domain/commons'
import type {
	AgentRunPurposeMismatchError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ProposalAlreadyReviewedError,
	ProposalTypeMismatchError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CommandContext } from './types'
import { appendAgentRunEvent } from '../utils/agent-runs'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, getRequired } from '../utils/command-storage'
import { getPendingProposalForAgentRunPurpose, proposalRejectedProjectedParts } from '../utils/proposals'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const rejectPlanOutputInputPipe = v.object({ proposalEventId: idPipe, reason: v.nullable(freeFormStringPipe) })
export type Input = PipeOutput<typeof rejectPlanOutputInputPipe>

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

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createRejectPlanOutputCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('rejectPlanOutput', rejectPlanOutputInputPipe, async (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return stamp

		return runtime.transactions.run<Result, Exclude<Error, InvalidInputError>>(async ({ storage, notifications }) => {
			const proposal = await getPendingProposalForAgentRunPurpose(storage, input.proposalEventId, 'proposed-plan-output', 'planning')
			if (!proposal.ok) return proposal

			const { agentRun, proposal: proposalEvent } = proposal.value
			const plan = await getRequired('plan', storage, agentRun.purpose.planId)
			if (!plan.ok) return plan

			return appendAgentRunEvent({ values: runtime.values, notifications }, storage, proposalEvent.agentRunId, {
				type: 'proposal-rejected',
				proposalEventId: proposalEvent.id,
				authorized: stamp.value,
				reason: input.reason,
				projectedParts: proposalRejectedProjectedParts(proposalEvent.id, input.reason),
			})
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, defaultAgentRunSandboxConfig, localStamp, seedProject, stamp } =
		await import('../utils/test-helpers')
	const proposalEventId = '01k00000000000000000000003'

	describe('rejectPlanOutput command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRunEvents.fail.get = true
			const command = createRejectPlanOutputCommand(createTestCoreRuntime(options))

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'rejectPlanOutput' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('appends a proposal rejection for a pending Plan proposal', async () => {
			const options = proposalFixture()
			const command = createRejectPlanOutputCommand(createTestCoreRuntime(options))

			const result = await command({ proposalEventId, reason: 'Needs changes.' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000010001',
					agentRunId: '01k00000000000000000000002',
					occurred: { at: '2026-06-10T12:00:00.000Z' },
					body: {
						type: 'proposal-rejected',
						proposalEventId,
						authorized: localStamp(),
						reason: 'Needs changes.',
						projectedParts: [{ type: 'text', text: `Proposal ${proposalEventId} rejected. Needs changes.`, metadata: null }],
					},
				},
			})
		})
	})

	function proposalFixture() {
		const options = createTestCoreServices()
		seedProject(options.tx, '01k00000000000000000000030')
		options.tx.plans.records.set('01k00000000000000000000028', {
			id: '01k00000000000000000000028',
			projectId: '01k00000000000000000000030',
			agentRunId: '01k00000000000000000000002',
			title: 'Plan',
			created: stamp,
			closed: null,
		})
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
		options.tx.agentRunEvents.records.set(proposalEventId, {
			id: proposalEventId,
			agentRunId: '01k00000000000000000000002',
			occurred: { at: stamp.at },
			body: {
				type: 'proposed-plan-output',
				assistantMessageEventId: '01j00000000000000000000000',
				toolCallId: 'call-1',
				output: {
					proposedDeliveries: {},
					proposedMemoryCreations: { memory: { parentId: null, title: 'Memory', body: '', children: {} } },
					proposedMemoryRevisions: {},
				},
			},
		})
		return options
	}
}
