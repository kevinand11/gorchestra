import { runAISDKTurn } from './ai-sdk-turn'
import { buildAgentRunModelContext } from './context'
import { appendAndEmit } from './event-emission'
import { completeAutonomousRunIfNeeded } from './run-completion'
import { toolsForAgentRunPurpose } from './tools'
import { nextTurnClaim, type TurnReasonClaim } from './turn-claims'
import { loadTurnModelUse } from './turn-model-use'
import type { AgentRunLoopState, AgentRunRuntimeError, ModelAgentRunRuntime, RunModelAgentRunOptions, TurnResult } from './types'
import type { AgentRun, AgentRunEvent, TurnErrorReason } from '../../domain/agent-run'
import type { Id } from '../../domain/commons'
import type { ModelNotSelectableError, ModelThinkingLevelUnavailableError } from '../../errors'
import type { CoreProviders } from '../../providers'
import type { CoreStorage } from '../../services'
import { getRequired, listRecords } from '../../storage/helpers'
import type { Result } from '../../utils/types'

export async function runModelAgentRun(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	options: RunModelAgentRunOptions = {},
): Promise<Result<void, AgentRunRuntimeError>> {
	const state = await loadLoopState(runtime.services.storage, agentRunId)
	if (!state.ok) return state
	if (state.value.agentRun.completed !== null) return { ok: true, value: undefined }
	if (!agentRunReadyForModelTurn(state.value.agentRun)) return { ok: true, value: undefined }

	const claim = nextTurnClaim(state.value.events)
	if (claim === null) return { ok: true, value: undefined }

	const turn = await runTurn(runtime, state.value, claim, options)
	if (!turn.ok) return turn
	return turn.value.type === 'completed' ? completeAutonomousRunIfNeeded(runtime, state.value.agentRun) : { ok: true, value: undefined }
}

async function loadLoopState(storage: CoreStorage, agentRunId: Id): Promise<Result<AgentRunLoopState, AgentRunRuntimeError>> {
	const agentRun = await getRequired('agent-run', storage, agentRunId)
	if (!agentRun.ok) return agentRun

	const events = await listRecords('agent-run-event', storage, {
		where: (filter, fields) => filter.eq(fields.agentRunId, agentRunId),
		orderBy: [{ field: 'cursor', direction: 'asc' }],
	})
	if (!events.ok) return events

	return { ok: true, value: { agentRun: agentRun.value, events: events.value, tools: toolsForAgentRunPurpose(agentRun.value.purpose) } }
}

function agentRunReadyForModelTurn(agentRun: AgentRun): boolean {
	return (
		agentRun.blocked === null &&
		agentRun.sandbox.assignment !== null &&
		agentRun.sandbox.appliedRequirements.length === agentRun.desiredRuntimeRequirements.length &&
		agentRun.sandbox.appliedThroughCursor === (agentRun.runtimeRequirementOverrides.at(-1)?.eventCursor ?? null)
	)
}

async function runTurn(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	claim: TurnReasonClaim,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	const turnStarted = await appendAndEmit(runtime, state.agentRun.id, turnStartedBody(claim), options)
	return turnStarted.ok ? runStartedTurn(runtime, state, claim, turnStarted.value, options) : turnStarted
}

function turnStartedBody(claim: TurnReasonClaim): AgentRunEvent['body'] {
	return { type: 'turn-started', contextThroughCursor: claim.contextThroughCursor, reason: claim.reason }
}

async function runStartedTurn(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	claim: TurnReasonClaim,
	turnStarted: AgentRunEvent,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	const turnModelUse = await loadTurnModelUse(runtime.services.storage, state.agentRun)
	if (!turnModelUse.ok) return handleTurnModelUseError(runtime, state.agentRun.id, turnStarted, turnModelUse.error, options)

	const resolution = await runtime.providers.modelProviderProtocols.resolveLanguageModel({
		mode: 'agent-run',
		model: turnModelUse.value.model,
		modelProvider: turnModelUse.value.modelProvider,
		thinking: turnModelUse.value.thinking,
	})
	if (!resolution.ok) return handleTurnModelUseError(runtime, state.agentRun.id, turnStarted, resolution.error, options)
	if (!('languageModel' in resolution.value)) {
		return recordTurnFailure(runtime, state.agentRun.id, turnStarted, resolution.value, options)
	}

	const modelContext = buildAgentRunModelContext(state.events, claim.contextThroughCursor)
	const aiTurn = await runAISDKTurn(runtime, state, turnStarted, turnModelUse.value, modelContext.messages, resolution.value, options)
	if (!aiTurn.ok) return aiTurn

	const ended = await appendAndEmit(
		runtime,
		state.agentRun.id,
		{ type: 'turn-ended', turnStartedCursor: turnStarted.cursor, outcome: aiTurn.value.turnOutcome },
		options,
	)
	if (!ended.ok) return ended

	return { ok: true, value: aiTurn.value.turnOutcome.type === 'completed' ? { type: 'completed' } : { type: 'failed' } }
}

async function handleTurnModelUseError(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	turnStarted: AgentRunEvent,
	error: AgentRunRuntimeError | ModelThinkingLevelUnavailableError | ModelNotSelectableError,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	if (error.type === 'model-thinking-level-unavailable' || error.type === 'model-not-selectable') {
		return recordTurnFailure(runtime, agentRunId, turnStarted, { type: 'runtime-error' }, options)
	}
	return { ok: false, error }
}

async function recordTurnFailure(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	turnStarted: AgentRunEvent,
	reason: TurnErrorReason,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	const turnEnded = await appendAndEmit(
		runtime,
		agentRunId,
		{ type: 'turn-ended', turnStartedCursor: turnStarted.cursor, outcome: { type: 'error', reason } },
		options,
	)
	return turnEnded.ok ? { ok: true, value: { type: 'failed' } } : turnEnded
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedSelectableModel } = await import('../../utils/test-helpers')

	describe('runModelAgentRun', () => {
		it('no-ops completed Agent Runs without processing queued input', async () => {
			const services = planningFixture()
			services.tx.agentRuns.records.get('agent-run-1')!.completed = { at: '2026-06-10T12:05:00.000Z' }
			const initialEventCount = services.tx.agentRunEvents.records.size
			const runtime = modelLoopRuntime(services)

			const result = await runModelAgentRun(runtime, 'agent-run-1')

			expect(result).toEqual({ ok: true, value: undefined })
			expect(services.tx.agentRunEvents.records.size).toBe(initialEventCount)
		})

		it('blocks after operator interrupts until new input', async () => {
			const services = planningFixture()
			services.tx.agentRunEvents.records.set('interrupt', {
				id: 'interrupt',
				agentRunId: 'agent-run-1',
				cursor: cursor(3),
				occurred: { at: '2026-06-10T12:00:00.000Z' },
				body: {
					type: 'interrupt-requested',
					source: { type: 'operator', authorized: { origin: 'imported', at: '2026-06-10T12:00:00.000Z' } },
					reason: null,
				},
			})
			const runtime = modelLoopRuntime(services)

			await expect(runModelAgentRun(runtime, 'agent-run-1')).resolves.toEqual({ ok: true, value: undefined })
			expect([...services.tx.agentRunEvents.records.values()].some((event) => event.body.type === 'turn-started')).toBe(false)

			services.tx.agentRunEvents.records.set('input-2', {
				id: 'input-2',
				agentRunId: 'agent-run-1',
				cursor: cursor(4),
				occurred: { at: '2026-06-10T12:00:00.000Z' },
				body: { type: 'input-message', source: { type: 'runtime' }, parts: [{ type: 'text', text: 'continue', metadata: null }] },
			})
			await expect(runModelAgentRun(runtime, 'agent-run-1')).resolves.toMatchObject({ ok: true })
			expect([...services.tx.agentRunEvents.records.values()].some((event) => event.body.type === 'turn-started')).toBe(true)
		})
	})

	function planningFixture() {
		const services = createTestCoreServices()
		seedSelectableModel(services.tx, 'model-1')
		services.tx.agentRuns.records.set('agent-run-1', {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: 'plan-1' },
			profile: {
				agentRunProfileId: 'agent-run-profile-1',
				name: 'Planning',
				modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
				runtimeRequirements: [],
			},
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: null,
			sandbox: {
				assignment: { ref: 'sandbox-ref', assigned: { at: '2026-06-10T12:00:00.000Z' } },
				appliedRequirements: [],
				appliedThroughCursor: null,
				released: null,
			},
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		})
		seedInitialEvents(services)
		return services
	}

	function seedInitialEvents(services: ReturnType<typeof createTestCoreServices>) {
		services.tx.agentRunEvents.records.set('input-1', {
			id: 'input-1',
			agentRunId: 'agent-run-1',
			cursor: cursor(1),
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: { type: 'input-message', source: { type: 'runtime' }, parts: [{ type: 'text', text: 'start', metadata: null }] },
		})
	}

	function modelLoopRuntime(services: ReturnType<typeof createTestCoreServices>): ModelAgentRunRuntime {
		return { services, providers: { ...createTestProviders() }, values: services.values }
	}

	function createTestProviders(): CoreProviders {
		return {
			sourceControl: {
				preflightRepository: () => Promise.reject(new Error('unused')),
				createArtifactBranch: () => Promise.reject(new Error('unused')),
				createReviewSurface: () => Promise.reject(new Error('unused')),
			},
			modelProviderProtocols: {
				preflightModel: () => Promise.reject(new Error('unused')),
				resolveLanguageModel: () => Promise.resolve({ ok: true, value: { type: 'runtime-error' } }),
			},
		}
	}

	function cursor(index: number): string {
		return `01J000000000000000000${index.toString().padStart(5, '0')}`
	}
}
