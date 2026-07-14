import { v, type PipeOutput } from 'valleyed'

import type { AgentRun } from '../domain/agent-run'
import { idPipe, nonEmptyTrimmedStringPipe, type RuntimeRecord } from '../domain/commons'
import type { Plan } from '../domain/plan'
import type { InvalidInputError } from '../errors'
import type { CommandContext } from './types'
import { requestAgentRunModelTurn } from '../dispatch/accept'
import { appendAgentRunEvent, createModelAgentRunAndRequestPreparation } from '../utils/agent-runs'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from '../utils/command-errors'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, createRecordValue, getRequired, isArchived, nextId, validateModelThinkingLevel } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const createPlanInputPipe = v.object({
	projectId: idPipe,
	title: nonEmptyTrimmedStringPipe,
	initialMessage: nonEmptyTrimmedStringPipe,
	agentRunProfileId: idPipe,
})
export type Input = PipeOutput<typeof createPlanInputPipe>

export type Result = Plan
export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createCreatePlanCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createPlan', createPlanInputPipe, async (input, context) => {
		const planId = nextId(runtime.values)
		if (!planId.ok) return planId

		const agentRunId = nextId(runtime.values)
		if (!agentRunId.ok) return agentRunId

		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return stamp

		return runtime.transactions.run<Plan, Error>(async ({ storage, notifications, dispatch }) => {
			const started: RuntimeRecord = { at: stamp.value.at }

			const project = await getRequired('project', storage, input.projectId)
			if (!project.ok) return project

			const profile = await getRequired('agent-run-profile', storage, input.agentRunProfileId)
			if (!profile.ok) return profile
			if (isArchived(profile.value.archivePeriods)) {
				return {
					ok: false,
					error: { type: 'resource-archived', resource: 'agent-run-profile', id: input.agentRunProfileId },
				}
			}

			const model = await getRequired('model', storage, profile.value.modelUse.modelId)
			if (!model.ok) return model
			if (isArchived(model.value.archivePeriods)) {
				return { ok: false, error: { type: 'resource-archived', resource: 'model', id: model.value.id } }
			}

			const provider = await getRequired('model-provider', storage, model.value.providerId)
			if (!provider.ok) return provider
			if (isArchived(provider.value.archivePeriods)) {
				return { ok: false, error: { type: 'resource-archived', resource: 'model-provider', id: provider.value.id } }
			}

			const thinkingLevelValidation = validateModelThinkingLevel(model.value, provider.value, profile.value.modelUse.thinkingLevel)
			if (!thinkingLevelValidation.ok) return thinkingLevelValidation

			const plan = await createRecordValue('plan', storage, {
				id: planId.value,
				agentRunId: agentRunId.value,
				projectId: input.projectId,
				title: input.title,
				created: stamp.value,
				closed: null,
			})
			if (!plan.ok) return plan

			const created = await createModelAgentRunAndRequestPreparation({ values: runtime.values, dispatch, notifications }, storage, {
				agentRunId: agentRunId.value,
				agentRunProfile: profile.value,
				project: project.value,
				purpose: { type: 'planning', planId: planId.value },
				started,
			})
			if (!created.ok) return created

			const inputMessage = await appendAgentRunEvent({ values: runtime.values, notifications }, storage, created.value.agentRun.id, {
				type: 'input-message',
				source: { type: 'operator', authorized: stamp.value },
				parts: [{ type: 'text', text: input.initialMessage, metadata: null }],
			})
			if (!inputMessage.ok) return inputMessage

			const modelTurnRequested = await requestAgentRunModelTurn(dispatch, agentRunId.value, inputMessage.value.id)
			return modelTurnRequested.ok ? plan : modelTurnRequested
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it, vi } = import.meta.vitest
	const {
		context,
		createTestCoreRuntime,
		createTestCoreServices,
		defaultAgentRunSandboxConfig,
		localStamp,
		seedAgentRunProfile,
		seedProject,
	} = await import('../utils/test-helpers')
	const { ensureGitRequirement, globalRuntimeRequirements } = await import('../utils/agent-run-runtime-requirements')

	describe('createPlan command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					projectId: '01k00000000000000000000030',
					title: 'Plan',
					initialMessage: ' ',
					agentRunProfileId: '01k00000000000000000000029',
				},
				context,
			)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'createPlan' } })
			expect(options.transactionCalls()).toBe(0)
		})

		it('creates a Plan and Planning Agent Run with the selected profile snapshot', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					projectId: '01k00000000000000000000030',
					title: '  Plan setup  ',
					initialMessage: '  Please plan repository onboarding.  ',
					agentRunProfileId: '01k00000000000000000000006',
				},
				context,
			)

			expect(result).toEqual({ ok: true, value: expectedPlan() })
			expect(options.tx.plans.records.get('01k00000000000000000010001')).toEqual(expectedPlan())
			expect(options.tx.agentRuns.records.get('01k00000000000000000010002')).toEqual(expectedPlanningAgentRun())
			const instructionBody = options.tx.agentRunEvents.records.get('01k00000000000000000010003')?.body
			expect(instructionBody).toMatchObject({
				type: 'instruction-snapshot',
				instruction: { type: 'source-control-planning', version: 1 },
			})
			expect(instructionBody?.type === 'instruction-snapshot' ? instructionBody.parts[0] : null).toMatchObject({
				type: 'text',
				metadata: null,
			})
			expect(options.tx.agentRunEvents.records.get('01k00000000000000000010005')?.body).toEqual({
				type: 'input-message',
				source: { type: 'operator', authorized: localStamp() },
				parts: [{ type: 'text', text: 'Please plan repository onboarding.', metadata: null }],
			})
		})

		it('persists Dispatch Requests and publishes one wake after commit in invocation order', async () => {
			const effects: string[] = []
			const options = createTestCoreServices({
				dispatchWake: { publish: () => effects.push('dispatch-wake'), subscribe: () => () => {} },
				notifications: {
					publish: ({ data }) =>
						effects.push(
							data.type === 'agent-run-event-created'
								? `notification:${data.type}:${data.event.body.type}`
								: `notification:${data.type}`,
						),
				},
			})
			seedProject(options.tx, '01k00000000000000000000030')
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(validPlanCreationInput(), context)

			expect(result).toMatchObject({ ok: true })
			expect([...options.tx.dispatchRequests.records.values()].map((request) => request.payload)).toEqual([
				{ type: 'agent-run-preparation', agentRunId: '01k00000000000000000010002' },
				{ type: 'agent-run-model-turn', agentRunId: '01k00000000000000000010002' },
			])
			expect(effects).toEqual([
				'notification:agent-run-created',
				'notification:agent-run-event-created:instruction-snapshot',
				'dispatch-wake',
				'notification:agent-run-event-created:input-message',
			])
			expect(options.tx.agentRunEvents.records.get('01k00000000000000000010005')?.body.type).toBe('input-message')
		})

		it('rolls back all writes and post-commit effects when Dispatch persistence fails', async () => {
			const published: unknown[] = []
			const wake = vi.fn()
			const options = createTestCoreServices({
				dispatchWake: { publish: wake, subscribe: () => () => {} },
				notifications: { publish: (notification) => published.push(notification) },
			})
			options.tx.dispatchRequests.fail.put = true
			seedProject(options.tx, '01k00000000000000000000030')
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(validPlanCreationInput(), context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'create', resource: 'dispatch-request' } },
			})
			expect(options.tx.plans.records.size).toBe(0)
			expect(options.tx.agentRuns.records.size).toBe(0)
			expect(options.tx.agentRunEvents.records.size).toBe(0)
			expect(published).toEqual([])
			expect(wake).not.toHaveBeenCalled()
		})

		it('rejects archived selected profiles', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024', { archived: true })
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(validPlanCreationInput(), context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'resource-archived', resource: 'agent-run-profile', id: '01k00000000000000000000006' },
			})
			expect(options.tx.plans.records.size).toBe(0)
			expect(options.tx.agentRuns.records.size).toBe(0)
		})
	})

	function validPlanCreationInput(): Input {
		return {
			projectId: '01k00000000000000000000030',
			title: 'Plan',
			initialMessage: 'Plan this.',
			agentRunProfileId: '01k00000000000000000000006',
		}
	}

	function expectedPlan(): Plan {
		return {
			id: '01k00000000000000000010001',
			projectId: '01k00000000000000000000030',
			agentRunId: '01k00000000000000000010002',
			title: 'Plan setup',
			created: localStamp(),
			closed: null,
		}
	}

	function expectedPlanningAgentRun(): AgentRun {
		return {
			id: '01k00000000000000000010002',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: '01k00000000000000000010001' },
			profile: {
				agentRunProfileId: '01k00000000000000000000006',
				name: 'Agent Run Profile',
				modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
				runtimeRequirements: [],
				sandboxConfig: defaultAgentRunSandboxConfig(),
			},
			toolSet: toolSet(['read', 'grep', 'find', 'ls', 'propose-plan-output']),
			modelUseOverride: null,
			sourceRuntimeRequirements: [...globalRuntimeRequirements, ensureGitRequirement],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [...globalRuntimeRequirements, ensureGitRequirement],
			blocked: { type: 'preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
			sandbox: null,
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
	}

	function toolSet(names: string[]) {
		return names.map((name) => ({ name, contractVersion: 1 }))
	}
}
