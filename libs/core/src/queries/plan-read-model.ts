import type { AgentRun } from '../domain/agent-run'
import type { Plan, PlanWithPlanningAgentRun, PlanningAgentRun } from '../domain/plan'
import type { InvariantViolationError } from '../errors'
import type { Result } from '../utils/types'

export function planReadModel(plan: Plan, agentRuns: AgentRun[]): Result<PlanWithPlanningAgentRun, InvariantViolationError> {
	const agentRun = planningAgentRunForPlan(plan, agentRuns)
	return agentRun.ok ? { ok: true, value: { ...plan, agentRun: agentRun.value } } : agentRun
}

export function planReadModels(plans: Plan[], agentRuns: AgentRun[]): Result<PlanWithPlanningAgentRun[], InvariantViolationError> {
	const readModels: PlanWithPlanningAgentRun[] = []
	for (const plan of plans) {
		const readModel = planReadModel(plan, agentRuns)
		if (!readModel.ok) return readModel
		readModels.push(readModel.value)
	}

	return { ok: true, value: readModels }
}

function planningAgentRunForPlan(plan: Plan, agentRuns: AgentRun[]): Result<PlanningAgentRun, InvariantViolationError> {
	const planningRuns = agentRuns.filter((agentRun): agentRun is PlanningAgentRun => isPlanningRunForPlan(agentRun, plan.id))
	const planningRun = planningRuns[0]
	if (planningRuns.length !== 1 || planningRun === undefined) return invalidPlanningRunCardinality(plan.id, planningRuns.length)

	return { ok: true, value: planningRun }
}

function isPlanningRunForPlan(agentRun: AgentRun, planId: Plan['id']): agentRun is PlanningAgentRun {
	return agentRun.purpose.type === 'planning' && agentRun.purpose.planId === planId
}

function invalidPlanningRunCardinality(planId: Plan['id'], count: number): Result<never, InvariantViolationError> {
	return {
		ok: false,
		error: {
			type: 'invariant-violation',
			message: `Plan ${planId} expected exactly one Planning Agent Run but found ${count}.`,
		},
	}
}
