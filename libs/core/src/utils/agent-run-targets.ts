import { getRequired } from '../commands/utils/storage'
import type { AgentRun } from '../domain/agent-run'
import type {
	AgentRunNotActiveError,
	AgentRunNotInteractiveError,
	InvalidCoreServiceOutputError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorage } from '../services'
import type { Result } from './types'

type InteractiveAgentRunError =
	| AgentRunNotInteractiveError
	| AgentRunNotActiveError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvalidCoreServiceOutputError

export async function requireInteractiveAgentRunOpen(
	storage: CoreStorage,
	agentRunId: string,
): Promise<Result<AgentRun, InteractiveAgentRunError>> {
	const agentRun = await getRequired('agent-run', storage, agentRunId)
	if (!agentRun.ok) return agentRun
	return interactiveAgentRun(agentRun.value)
}

function interactiveAgentRun(agentRun: AgentRun): Result<AgentRun, AgentRunNotInteractiveError | AgentRunNotActiveError> {
	if (agentRun.purpose.type !== 'planning' && agentRun.purpose.type !== 'revision-planning') {
		return { ok: false, error: { type: 'agent-run-not-interactive', agentRunId: agentRun.id } }
	}
	return agentRun.completed === null ? { ok: true, value: agentRun } : agentRunNotActive(agentRun.id)
}

function agentRunNotActive(agentRunId: string): Result<never, AgentRunNotActiveError> {
	return { ok: false, error: { type: 'agent-run-not-active', agentRunId } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, defaultAgentRunSandboxConfig } = await import('./test-helpers')

	describe('requireInteractiveAgentRunOpen', () => {
		it('passes for a planning Agent Run', async () => {
			const options = createTestCoreServices()
			const agentRun = planningAgentRun()
			options.tx.agentRuns.records.set(agentRun.id, agentRun)

			const result = await requireInteractiveAgentRunOpen(options.storage, '01k00000000000000000000002')

			expect(result).toEqual({ ok: true, value: agentRun })
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

			const result = await requireInteractiveAgentRunOpen(options.storage, '01k00000000000000000000002')

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-interactive', agentRunId: '01k00000000000000000000002' } })
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
