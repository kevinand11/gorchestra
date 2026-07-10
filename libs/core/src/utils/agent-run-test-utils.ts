import { createTestCoreServices, stamp, testModelAgentRun } from './test-helpers'
import type { AgentRun } from '../domain/agent-run'
import type { AgentRunEvent } from '../domain/agent-run-event'
import type { RevisionGate } from '../domain/revision-gate'
import type { CoreServices } from '../services'

export function planningAgentRunFixture(overrides: Partial<Pick<CoreServices, 'dispatcher'>> = {}) {
	const options = createTestCoreServices(overrides)
	options.tx.plans.records.set('01k00000000000000000000028', {
		id: '01k00000000000000000000028',
		projectId: '01k00000000000000000000030',
		agentRunId: '01k00000000000000000000002',
		title: 'Plan',
		created: stamp,
		closed: null,
	})
	options.tx.agentRuns.records.set('01k00000000000000000000002', planningAgentRun())
	return options
}

export function revisionPlanningAgentRunFixture(closed: boolean, overrides: Partial<Pick<CoreServices, 'dispatcher'>> = {}) {
	const options = createTestCoreServices(overrides)
	options.tx.agentRuns.records.set('01k00000000000000000000002', revisionPlanningAgentRun())
	options.tx.revisionGates.records.set('01k00000000000000000000039', revisionGate(closed))
	return options
}

export function autonomousAgentRunFixture(completed: boolean, overrides: Partial<Pick<CoreServices, 'dispatcher'>> = {}) {
	const options = createTestCoreServices(overrides)
	options.tx.agentRuns.records.set('01k00000000000000000000002', {
		...planningAgentRun(),
		purpose: {
			type: 'execution',
			deliveryId: '01k00000000000000000000008',
			sliceId: '01k00000000000000000000042',
			mode: { type: 'initial' },
		},
		completed: completed ? { at: '2026-06-10T12:05:00.000Z' } : null,
	})
	return options
}

export function inputEvent(id: string, agentRunId: string, _sequence: number): AgentRunEvent {
	return {
		id,
		agentRunId,
		occurred: { at: '2026-06-10T12:00:00.000Z' },
		body: {
			type: 'input-message',
			source: { type: 'runtime' },
			parts: [{ type: 'text', text: 'Earlier context.', metadata: null }],
		},
	}
}

export function planningAgentRun(): AgentRun {
	return testModelAgentRun({ purpose: { type: 'planning', planId: '01k00000000000000000000028' } })
}

export function revisionPlanningAgentRun(): AgentRun {
	return {
		...planningAgentRun(),
		purpose: { type: 'revision-planning', revisionGateId: '01k00000000000000000000039' },
	}
}

function revisionGate(closed: boolean): RevisionGate {
	return {
		id: '01k00000000000000000000039',
		agentRunId: '01k00000000000000000000002',
		scope: { type: 'delivery-artifact', deliveryId: '01k00000000000000000000008', deliveryArtifactId: '01k00000000000000000000010' },
		reviewSurfaceId: '01k00000000000000000000037',
		opened: stamp,
		closed: closed ? { type: 'closed-without-revision', closed: stamp } : null,
	}
}
