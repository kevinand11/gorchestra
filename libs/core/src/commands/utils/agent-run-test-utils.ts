import type { AgentRun, AgentRunEvent } from '../../domain/agent-run'
import type { RevisionGate } from '../../domain/revision'
import type { CoreServices } from '../../services'
import { createTestCoreServices, stamp } from '../../utils/test-helpers'

export function planningAgentRunFixture(overrides: Partial<Pick<CoreServices, 'dispatcher'>> = {}) {
	const options = createTestCoreServices(overrides)
	options.tx.plans.records.set('plan-1', {
		id: 'plan-1',
		projectId: 'project-1',
		title: 'Plan',
		config: null,
		created: stamp,
		closed: null,
	})
	options.tx.agentRuns.records.set('agent-run-1', planningAgentRun())
	return options
}

export function revisionPlanningAgentRunFixture(closed: boolean, overrides: Partial<Pick<CoreServices, 'dispatcher'>> = {}) {
	const options = createTestCoreServices(overrides)
	options.tx.agentRuns.records.set('agent-run-1', revisionPlanningAgentRun())
	options.tx.revisionGates.records.set('revision-gate-1', revisionGate(closed))
	return options
}

export function autonomousAgentRunFixture(completed: boolean, overrides: Partial<Pick<CoreServices, 'dispatcher'>> = {}) {
	const options = createTestCoreServices(overrides)
	options.tx.agentRuns.records.set('agent-run-1', {
		...planningAgentRun(),
		purpose: { type: 'execution', deliveryId: 'delivery-1', sliceId: 'slice-1', mode: { type: 'initial' } },
		completed: completed ? { at: '2026-06-10T12:05:00.000Z' } : null,
	})
	return options
}

export function inputEvent(id: string, agentRunId: string, sequence: number): AgentRunEvent {
	return {
		id,
		agentRunId,
		cursor: `01J000000000000000000${sequence.toString().padStart(5, '0')}`,
		occurred: { at: '2026-06-10T12:00:00.000Z' },
		body: {
			type: 'input-message',
			source: { type: 'runtime' },
			content: [{ type: 'text', text: 'Earlier context.' }],
		},
	}
}

export function planningAgentRun(): AgentRun {
	return {
		id: 'agent-run-1',
		agent: { type: 'model' },
		purpose: { type: 'planning', planId: 'plan-1' },
		started: { at: '2026-06-10T12:00:00.000Z' },
		completed: null,
	}
}

export function revisionPlanningAgentRun(): AgentRun {
	return {
		...planningAgentRun(),
		purpose: { type: 'revision-planning', revisionGateId: 'revision-gate-1' },
	}
}

function revisionGate(closed: boolean): RevisionGate {
	return {
		id: 'revision-gate-1',
		scope: { type: 'delivery-artifact', deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
		reviewSurfaceId: 'review-surface-1',
		opened: stamp,
		closed: closed ? { type: 'closed-without-revision', closed: stamp } : null,
	}
}
