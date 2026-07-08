import { v, type PipeOutput } from 'valleyed'

import type { AgentRunEvent } from '../domain/agent-run'
import { freeFormStringPipe, idPipe, type AuditStamp, type Id } from '../domain/commons'
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
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import type { CommandContext } from './types'
import { appendAgentRunEvent } from '../utils/agent-runs'
import { getPendingProposalForAgentRunPurpose, proposalRejectedProjectedParts } from '../utils/proposals'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { auditStamp, getRequired, withTransaction } from './utils/storage'

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
	return buildCommandHandler('rejectPlanOutput', rejectPlanOutputInputPipe, (input, context) =>
		handleRejectPlanOutput(runtime, input, context),
	)
}

async function handleRejectPlanOutput(
	runtime: CoreRuntime,
	input: Input,
	context: CommandContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const stamp = auditStamp(runtime.values, context)
	return stamp.ok ? withTransaction(runtime.services, (storage) => rejectPlanOutput(runtime, storage, input, stamp.value)) : stamp
}

async function rejectPlanOutput(
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const proposal = await loadRejectablePlanProposal(storage, input.proposalEventId)
	return proposal.ok
		? appendAgentRunEvent(runtime, storage, proposal.value.agentRunId, {
				type: 'proposal-rejected',
				proposalEventId: proposal.value.id,
				authorized: stamp,
				reason: input.reason,
				projectedParts: proposalRejectedProjectedParts(proposal.value.id, input.reason),
			})
		: proposal
}

async function loadRejectablePlanProposal(
	storage: CoreStorage,
	proposalEventId: Id,
): Promise<CoreResult<AgentRunEvent, Exclude<Error, InvalidInputError>>> {
	const proposal = await getPendingProposalForAgentRunPurpose(storage, proposalEventId, 'proposed-plan-output', 'planning')
	if (!proposal.ok) return proposal

	const plan = await getRequired('plan', storage, proposal.value.agentRun.purpose.planId)
	return plan.ok ? { ok: true, value: proposal.value.proposal } : plan
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
