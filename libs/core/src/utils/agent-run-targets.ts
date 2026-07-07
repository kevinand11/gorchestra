import { getRequired } from '../commands/utils/storage'
import type { AgentRun } from '../domain/agent-run'
import type {
	AgentRunNotActiveError,
	AgentRunNotInteractiveError,
	InvalidCoreServiceOutputError,
	PlanClosedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorage } from '../services'
import type { Result } from './types'

export type InteractiveAgentRunTargetError =
	| AgentRunNotInteractiveError
	| AgentRunNotActiveError
	| PlanClosedError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvalidCoreServiceOutputError

export async function requireInteractiveAgentRunTargetOpen(
	storage: CoreStorage,
	agentRunId: string,
): Promise<Result<AgentRun, InteractiveAgentRunTargetError>> {
	const agentRun = await getRequired('agent-run', storage, agentRunId)
	return agentRun.ok ? validateInteractiveAgentRunTargetOpen(storage, agentRun.value) : agentRun
}

async function validateInteractiveAgentRunTargetOpen(
	storage: CoreStorage,
	agentRun: AgentRun,
): Promise<Result<AgentRun, InteractiveAgentRunTargetError>> {
	const state = interactiveAgentRunState(agentRun)
	if (!state.ok) return state

	return state.value === 'planning' ? validatePlanStillExists(storage, agentRun) : validateRevisionGateStillOpen(storage, agentRun)
}

function interactiveAgentRunState(
	agentRun: AgentRun,
): Result<'planning' | 'revision-planning', AgentRunNotInteractiveError | AgentRunNotActiveError> {
	if (agentRun.purpose.type !== 'planning' && agentRun.purpose.type !== 'revision-planning') {
		return { ok: false, error: { type: 'agent-run-not-interactive', agentRunId: agentRun.id } }
	}
	return agentRun.completed === null ? { ok: true, value: agentRun.purpose.type } : agentRunNotActive(agentRun.id)
}

async function validatePlanStillExists(
	storage: CoreStorage,
	agentRun: AgentRun,
): Promise<Result<AgentRun, InteractiveAgentRunTargetError>> {
	const planId = agentRun.purpose.type === 'planning' ? agentRun.purpose.planId : ''
	const plan = await getRequired('plan', storage, planId)
	if (!plan.ok) return plan

	return plan.value.closed === null ? { ok: true, value: agentRun } : planClosed(plan.value.id)
}

async function validateRevisionGateStillOpen(
	storage: CoreStorage,
	agentRun: AgentRun,
): Promise<Result<AgentRun, InteractiveAgentRunTargetError>> {
	const revisionGateId = agentRun.purpose.type === 'revision-planning' ? agentRun.purpose.revisionGateId : ''
	const gate = await getRequired('revision-gate', storage, revisionGateId)
	if (!gate.ok) return gate

	return gate.value.closed === null ? { ok: true, value: agentRun } : agentRunNotActive(agentRun.id)
}

function agentRunNotActive(agentRunId: string): Result<never, AgentRunNotActiveError> {
	return { ok: false, error: { type: 'agent-run-not-active', agentRunId } }
}

function planClosed(planId: string): Result<never, PlanClosedError> {
	return { ok: false, error: { type: 'plan-closed', planId } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, defaultAgentRunSandboxConfig, stamp } = await import('./test-helpers')

	describe('requireInteractiveAgentRunTargetOpen', () => {
		it('passes for a planning Agent Run with an existing Plan', async () => {
			const options = createTestCoreServices()
			options.tx.plans.records.set('01k00000000000000000000028', {
				id: '01k00000000000000000000028',
				projectId: '01k00000000000000000000030',
				title: 'Plan',
				created: stamp,
				closed: null,
			})
			const agentRun = planningAgentRun()
			options.tx.agentRuns.records.set(agentRun.id, agentRun)

			const result = await requireInteractiveAgentRunTargetOpen(options.storage, '01k00000000000000000000002')

			expect(result).toEqual({ ok: true, value: agentRun })
		})

		it('rejects planning Agent Runs whose Plan is closed', async () => {
			const options = createTestCoreServices()
			options.tx.plans.records.set('01k00000000000000000000028', {
				id: '01k00000000000000000000028',
				projectId: '01k00000000000000000000030',
				title: 'Plan',
				created: stamp,
				closed: stamp,
			})
			const agentRun = planningAgentRun()
			options.tx.agentRuns.records.set(agentRun.id, agentRun)

			const result = await requireInteractiveAgentRunTargetOpen(options.storage, '01k00000000000000000000002')

			expect(result).toEqual({ ok: false, error: { type: 'plan-closed', planId: '01k00000000000000000000028' } })
		})

		it('rejects execution Agent Runs as non-interactive', async () => {
			const options = createTestCoreServices()
			options.tx.agentRuns.records.set('01k00000000000000000000002', {
				...planningAgentRun(),
				purpose: {
					type: 'execution',
					deliveryId: '01k00000000000000000000008',
					sliceId: '01k00000000000000000000042',
					mode: { type: 'initial' },
				},
			})

			const result = await requireInteractiveAgentRunTargetOpen(options.storage, '01k00000000000000000000002')

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-interactive', agentRunId: '01k00000000000000000000002' } })
		})

		it('rejects revision-planning Agent Runs whose Revision Gate is closed', async () => {
			const options = createTestCoreServices()
			options.tx.agentRuns.records.set('01k00000000000000000000002', {
				...planningAgentRun(),
				purpose: { type: 'revision-planning', revisionGateId: '01k00000000000000000000039' },
			})
			options.tx.revisionGates.records.set('01k00000000000000000000039', {
				id: '01k00000000000000000000039',
				scope: {
					type: 'delivery-artifact',
					deliveryId: '01k00000000000000000000008',
					deliveryArtifactId: '01k00000000000000000000010',
				},
				reviewSurfaceId: '01k00000000000000000000037',
				opened: stamp,
				closed: { type: 'closed-without-revision', closed: stamp },
			})

			const result = await requireInteractiveAgentRunTargetOpen(options.storage, '01k00000000000000000000002')

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-active', agentRunId: '01k00000000000000000000002' } })
		})
	})

	function planningAgentRun(): AgentRun {
		return {
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
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: null,
			sandbox: {
				key: '01k00000000000000000000002',
				created: null,
				appliedRequirements: [],
				appliedThroughEventId: null,
				released: null,
			},
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
	}
}
