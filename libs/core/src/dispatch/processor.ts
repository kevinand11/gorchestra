import { v, type PipeOutput } from 'valleyed'

import type { AgentRun } from '../domain/agent-run'
import type { AgentRunEvent } from '../domain/agent-run-event'
import type { Delivery } from '../domain/delivery'
import type { DispatchRequest, DispatchRequestPayload } from '../domain/dispatch-request'
import type {
	DispatchProcessorAlreadyStartedError,
	DispatchStorageIncompatibleError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../utils/runtime'
import { getRequired, listRecords, updateRecord } from '../utils/storage/helpers'
import type { CoreTransaction } from '../utils/transactions'
import type { Result, UndefinedToOptional } from '../utils/types'
import { validateCoreInput } from '../validation'
import { admitDispatchRequests } from './admission'
import { heartbeatDispatchAttempts, interruptDispatchAttempt } from './attempts'
import { exclusiveAgentRunClaim, exclusiveDeliverySchedulerClaim } from './claims'
import { failDispatchRequestWithEvidence } from './failure'
import { createDispatchAttemptController, type DispatchAttemptController } from './fence'
import { defaultDispatchProcessorOptions } from './options'
import { pruneCompletedDispatchRequests } from './prune'
import { createDispatchRouter, type DispatchRouter } from './router'

const positiveIntegerPipe = v.number().pipe(v.int(), v.gte(1))
const processorInputPipe = v.object({
	maxConcurrentAttempts: v.optional(positiveIntegerPipe),
	heartbeatMs: v.optional(positiveIntegerPipe),
	leaseMs: v.optional(positiveIntegerPipe),
	idlePollMinMs: v.optional(positiveIntegerPipe),
	idlePollMaxMs: v.optional(positiveIntegerPipe),
	interruptedAttemptLimit: v.optional(positiveIntegerPipe),
	completedRetentionMs: v.optional(positiveIntegerPipe),
	pruneBatchSize: v.optional(positiveIntegerPipe),
	shutdownGraceMs: v.optional(positiveIntegerPipe),
})

type ParsedDispatchProcessorInput = PipeOutput<typeof processorInputPipe>
export type CoreDispatchProcessorInput = UndefinedToOptional<ParsedDispatchProcessorInput>

interface ResolvedDispatchProcessorOptions {
	maxConcurrentAttempts: number
	heartbeatMs: number
	leaseMs: number
	idlePollMinMs: number
	idlePollMaxMs: number
	interruptedAttemptLimit: number
	completedRetentionMs: number
	pruneBatchSize: number
	shutdownGraceMs: number
}

export type CoreDispatchProcessorStatus =
	| { type: 'starting' }
	| { type: 'running'; activeAttempts: number }
	| { type: 'stopping'; activeAttempts: number }
	| { type: 'stopped' }
	| { type: 'failed'; error: CoreDispatchProcessorFatalError }

export type CoreDispatchProcessorStartError = InvalidInputError | DispatchProcessorAlreadyStartedError
export type CoreDispatchProcessorFatalError = StorageOperationFailedError | InvalidCoreServiceOutputError | DispatchStorageIncompatibleError

export interface CoreDispatchApi {
	startProcessor(input?: CoreDispatchProcessorInput): Result<CoreDispatchProcessorHandle, CoreDispatchProcessorStartError>
}

export interface CoreDispatchProcessorHandle {
	status(): CoreDispatchProcessorStatus
	stop(): Promise<void>
	readonly ready: Promise<Result<void, CoreDispatchProcessorFatalError>>
	readonly completed: Promise<Result<void, CoreDispatchProcessorFatalError>>
}

interface ActiveAttempt {
	request: DispatchRequest
	controller: DispatchAttemptController
	abortController: AbortController
	settled: Promise<void>
}

interface DispatchProcessorDependencies {
	router?: DispatchRouter
	random?: () => number
}

export function createCoreDispatchApi(runtime: CoreRuntime, dependencies: DispatchProcessorDependencies = {}): CoreDispatchApi {
	let current: CoreDispatchProcessorHandle | null = null
	return {
		startProcessor(input: CoreDispatchProcessorInput = {}) {
			const status = current?.status().type
			if (status === 'starting' || status === 'running' || status === 'stopping') {
				return { ok: false, error: { type: 'dispatch-processor-already-started' } }
			}
			const options = resolveDispatchProcessorOptions(input)
			if (!options.ok) return options
			current = startDispatchProcessor(runtime, options.value, {
				router: dependencies.router ?? createDispatchRouter(runtime),
				random: dependencies.random ?? Math.random,
			})
			return { ok: true, value: current }
		},
	}
}

function resolveDispatchProcessorOptions(input: CoreDispatchProcessorInput): Result<ResolvedDispatchProcessorOptions, InvalidInputError> {
	const parsed = validateCoreInput(processorInputPipe, input, 'core', 'startDispatchProcessor')
	if (!parsed.ok) return parsed
	const options: ResolvedDispatchProcessorOptions = {
		maxConcurrentAttempts: parsed.value.maxConcurrentAttempts ?? defaultDispatchProcessorOptions.maxConcurrentAttempts,
		heartbeatMs: parsed.value.heartbeatMs ?? defaultDispatchProcessorOptions.heartbeatMs,
		leaseMs: parsed.value.leaseMs ?? defaultDispatchProcessorOptions.leaseMs,
		idlePollMinMs: parsed.value.idlePollMinMs ?? defaultDispatchProcessorOptions.idlePollMinMs,
		idlePollMaxMs: parsed.value.idlePollMaxMs ?? defaultDispatchProcessorOptions.idlePollMaxMs,
		interruptedAttemptLimit: parsed.value.interruptedAttemptLimit ?? defaultDispatchProcessorOptions.interruptedAttemptLimit,
		completedRetentionMs: parsed.value.completedRetentionMs ?? defaultDispatchProcessorOptions.completedRetentionMs,
		pruneBatchSize: parsed.value.pruneBatchSize ?? defaultDispatchProcessorOptions.pruneBatchSize,
		shutdownGraceMs: parsed.value.shutdownGraceMs ?? defaultDispatchProcessorOptions.shutdownGraceMs,
	}
	if (options.leaseMs >= options.heartbeatMs * 3 && options.idlePollMinMs <= options.idlePollMaxMs) {
		return { ok: true, value: options }
	}
	const invalid = validateCoreInput(v.object({ valid: v.eq(true) }), { valid: false }, 'core', 'startDispatchProcessor')
	if (invalid.ok) throw new Error('Expected invalid Dispatch processor options.')
	return invalid
}

function startDispatchProcessor(
	runtime: CoreRuntime,
	options: ResolvedDispatchProcessorOptions,
	dependencies: Required<DispatchProcessorDependencies>,
): CoreDispatchProcessorHandle {
	let phase: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' = 'starting'
	let fatalError: CoreDispatchProcessorFatalError | null = null
	let idlePollMs = options.idlePollMinMs
	let nextPruneAt = 0
	let wake: (() => void) | null = null
	const active = new Map<string, ActiveAttempt>()
	let resolveReady: (result: Result<void, CoreDispatchProcessorFatalError>) => void = () => {}
	let readySettled = false
	const ready = new Promise<Result<void, CoreDispatchProcessorFatalError>>((resolve) => {
		resolveReady = resolve
	})
	let resolveCompleted: (result: Result<void, CoreDispatchProcessorFatalError>) => void = () => {}
	const completed = new Promise<Result<void, CoreDispatchProcessorFatalError>>((resolve) => {
		resolveCompleted = resolve
	})
	const settleReady = (result: Result<void, CoreDispatchProcessorFatalError>) => {
		if (readySettled) return
		readySettled = true
		resolveReady(result)
	}
	let unsubscribe = () => {}
	try {
		unsubscribe = runtime.services.dispatchWake?.subscribe(() => wake?.()) ?? (() => {})
	} catch {
		// Wake is best-effort; authoritative polling remains active.
	}

	const unsubscribeWake = () => {
		try {
			unsubscribe()
		} catch {
			// Wake cleanup is best-effort.
		}
	}

	const heartbeat = setInterval(() => {
		if (phase !== 'running' || active.size === 0) return
		void heartbeatDispatchAttempts(
			runtime,
			[...active.values()].map(({ request, controller }) => ({ request, attempt: controller.attempt })),
			options.leaseMs,
		).then((result) => {
			if (!result.ok) {
				for (const item of active.values()) item.abortController.abort()
				if (result.error.type === 'invalid-core-service-output') fail(result.error)
				return
			}
			for (const lost of result.value) active.get(dispatchAttemptKey(lost.requestId, lost.attemptToken))?.abortController.abort()
		})
	}, options.heartbeatMs)

	const processorFailed = () => phase === 'failed'

	const fail = (error: CoreDispatchProcessorFatalError) => {
		if (phase === 'failed' || phase === 'stopped') return
		phase = 'failed'
		fatalError = error
		clearInterval(heartbeat)
		unsubscribeWake()
		wake?.()
		for (const item of active.values()) item.abortController.abort()
		settleReady({ ok: false, error })
		resolveCompleted({ ok: false, error })
	}

	const processRequest = (request: DispatchRequest) => {
		if (request.lifecycle.type !== 'leased') return
		const key = dispatchAttemptKey(request.id, request.lifecycle.attempt.token)
		const abortController = new AbortController()
		const controller = createDispatchAttemptController(runtime, request, request.lifecycle.attempt, abortController)
		const persistFailure = async (error: unknown) => {
			if (isDispatchAttemptInterruption(error)) return
			const errorType = dispatchErrorType(error)
			if (errorType === 'invalid-core-service-output') {
				fail(error as InvalidCoreServiceOutputError)
				return
			}
			if (errorType === 'invariant-violation' || errorType === 'not-found') {
				fail({ type: 'dispatch-storage-incompatible', summary: 'Persisted Dispatch state is incompatible.' })
				return
			}
			if (errorType === 'storage-operation-failed') return
			const failed = await controller.runWrite((tx) =>
				failDispatchRequestWithEvidence({ tx, values: runtime.values }, request, controller.attempt, error),
			)
			if (!failed.ok) {
				const failureType = dispatchErrorType(failed.error)
				if (failureType === 'invalid-core-service-output') fail(failed.error as InvalidCoreServiceOutputError)
				else if (failureType === 'invariant-violation' || failureType === 'not-found') {
					fail({ type: 'dispatch-storage-incompatible', summary: 'Persisted Dispatch state is incompatible.' })
				}
			}
		}
		const settled = (async () => {
			let routed: Awaited<ReturnType<DispatchRouter>>
			try {
				routed = await dependencies.router(controller)
			} catch (error) {
				routed = { ok: false, error }
			}
			if (!routed.ok) {
				await persistFailure(routed.error)
				return
			}
			const committed = await controller.commitOutcome(routed.value)
			if (!committed.ok) await persistFailure(committed.error)
		})().finally(() => {
			if (active.get(key)?.controller === controller) active.delete(key)
			wake?.()
		})
		active.set(key, { request, controller, abortController, settled })
	}

	const waitForWake = (delayMs: number) =>
		new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				wake = null
				resolve()
			}, delayMs)
			wake = () => {
				clearTimeout(timer)
				wake = null
				idlePollMs = options.idlePollMinMs
				resolve()
			}
		})

	const runTick = async (initial = false): Promise<CoreDispatchProcessorFatalError | null> => {
		const maintenance = await runDispatchMaintenance(runtime, options, nextPruneAt)
		nextPruneAt = maintenance.nextPruneAt
		if (maintenance.fatal !== null) return maintenance.fatal
		const admitted = await admitDispatchRequests(runtime, {
			availableSlots: Math.max(0, options.maxConcurrentAttempts - active.size),
			maxConcurrentAttempts: options.maxConcurrentAttempts,
			leaseMs: options.leaseMs,
			interruptedAttemptLimit: options.interruptedAttemptLimit,
			locallyActiveAttemptTokens: [...active.values()].map((item) => item.controller.attempt.token),
		})
		const fatal = dispatchAdmissionFatalError(admitted, initial)
		if (fatal !== null) return fatal
		if (admitted.ok && phase !== 'starting' && phase !== 'running') {
			for (const request of admitted.value) {
				if (request.lifecycle.type === 'leased') {
					await interruptDispatchAttempt(runtime, request, request.lifecycle.attempt, 'processor-shutdown')
				}
			}
			return null
		}
		if (admitted.ok) {
			for (const request of admitted.value) processRequest(request)
			idlePollMs = admitted.value.length > 0 ? options.idlePollMinMs : Math.min(options.idlePollMaxMs, idlePollMs * 2)
		}
		return null
	}

	const loop = async () => {
		const bootstrapped = await bootstrapLegacyDispatch(runtime)
		if (!bootstrapped.ok) {
			fail(dispatchBootstrapStartupFatalError(bootstrapped.error))
			return
		}
		const initialFatal = await runTick(true)
		if (initialFatal !== null) {
			fail(initialFatal)
			return
		}
		if (phase !== 'starting') {
			settleReady({ ok: true, value: undefined })
			return
		}
		phase = 'running'
		settleReady({ ok: true, value: undefined })

		while (phase === 'running') {
			const fatal = await runTick()
			if (fatal !== null) {
				fail(fatal)
				return
			}
			if (phase !== 'running') break
			const jittered = Math.max(1, Math.floor(idlePollMs * (0.5 + dependencies.random() * 0.5)))
			await waitForWake(jittered)
		}
	}
	const loopPromise = loop().catch(() =>
		fail({ type: 'dispatch-storage-incompatible', summary: 'Dispatch processor stopped unexpectedly.' }),
	)

	return {
		ready,
		completed,
		status: () => {
			switch (phase) {
				case 'starting':
					return { type: 'starting' }
				case 'running':
					return { type: 'running', activeAttempts: active.size }
				case 'stopping':
					return { type: 'stopping', activeAttempts: active.size }
				case 'stopped':
					return { type: 'stopped' }
				case 'failed':
					if (fatalError === null) throw new Error('Expected failed Dispatch processor error.')
					return { type: 'failed', error: fatalError }
				default:
					throw new Error('Unhandled Dispatch processor status.')
			}
		},
		stop: async () => {
			if (phase === 'stopped' || phase === 'failed') return
			phase = 'stopping'
			clearInterval(heartbeat)
			unsubscribeWake()
			wake?.()
			await loopPromise
			if (processorFailed()) return
			const stoppingAttempts = [...active.values()]
			for (const item of stoppingAttempts) item.abortController.abort()
			await Promise.race([
				Promise.allSettled(stoppingAttempts.map((item) => item.settled)),
				new Promise((resolve) => setTimeout(resolve, options.shutdownGraceMs)),
			])
			if (processorFailed()) return
			for (const item of stoppingAttempts) {
				await interruptDispatchAttempt(runtime, item.request, item.controller.attempt, 'processor-shutdown')
			}
			if (processorFailed()) return
			phase = 'stopped'
			settleReady({ ok: true, value: undefined })
			resolveCompleted({ ok: true, value: undefined })
		},
	}
}

function dispatchBootstrapStartupFatalError(error: DispatchBootstrapError): CoreDispatchProcessorFatalError {
	switch (error.type) {
		case 'storage-operation-failed':
		case 'invalid-core-service-output':
		case 'dispatch-storage-incompatible':
			return error
		case 'invariant-violation':
			return { type: 'dispatch-storage-incompatible', summary: error.message }
		default:
			throw new Error('Unhandled Dispatch bootstrap error.')
	}
}

async function runDispatchMaintenance(
	runtime: CoreRuntime,
	options: ResolvedDispatchProcessorOptions,
	nextPruneAt: number,
): Promise<{ nextPruneAt: number; fatal: CoreDispatchProcessorFatalError | null }> {
	let now = 0
	try {
		now = runtime.values.now().getTime()
	} catch {
		return { nextPruneAt, fatal: null }
	}
	if (now < nextPruneAt) return { nextPruneAt, fatal: null }
	const pruned = await pruneCompletedDispatchRequests(runtime, {
		completedRetentionMs: options.completedRetentionMs,
		pruneBatchSize: options.pruneBatchSize,
	})
	const fatal = !pruned.ok && pruned.error.type === 'invalid-core-service-output' ? pruned.error : null
	return { nextPruneAt: now + Math.min(60 * 60_000, options.completedRetentionMs), fatal }
}

function dispatchAdmissionFatalError(
	result: Awaited<ReturnType<typeof admitDispatchRequests>>,
	initial = false,
): CoreDispatchProcessorFatalError | null {
	if (result.ok) return null
	if (result.error.type === 'storage-operation-failed') return initial ? result.error : null
	if (result.error.type === 'invalid-core-service-output') return result.error
	return { type: 'dispatch-storage-incompatible', summary: 'Persisted Dispatch state is incompatible.' }
}

function dispatchAttemptKey(requestId: string, attemptToken: string): string {
	return `${requestId}:${attemptToken}`
}

function dispatchErrorType(error: unknown): string | null {
	return typeof error === 'object' && error !== null && 'type' in error && typeof error.type === 'string' ? error.type : null
}

function isDispatchAttemptInterruption(error: unknown): boolean {
	const type = dispatchErrorType(error)
	return type === 'dispatch-fence-lost' || type === 'dispatch-attempt-aborted'
}

type DispatchBootstrapError =
	| StorageOperationFailedError
	| InvalidCoreServiceOutputError
	| DispatchStorageIncompatibleError
	| InvariantViolationError

async function bootstrapLegacyDispatch(runtime: CoreRuntime): Promise<Result<void, DispatchBootstrapError>> {
	return runtime.transactions.run<void, DispatchBootstrapError>((tx) => bootstrapLegacyDispatchInTransaction(tx))
}

async function bootstrapLegacyDispatchInTransaction(tx: CoreTransaction): Promise<Result<void, DispatchBootstrapError>> {
	const coordination = await getRequired('dispatch-coordination', tx.storage, '00000000000000000000000000')
	if (!coordination.ok) {
		return coordination.error.type === 'not-found'
			? { ok: false, error: { type: 'dispatch-storage-incompatible', summary: 'Dispatch Coordination is missing.' } }
			: { ok: false, error: coordination.error }
	}
	if (coordination.value.bootstrapVersion >= 1) return { ok: true, value: undefined }

	const facts = await loadDispatchBootstrapFacts(tx)
	if (!facts.ok) return facts
	const agentRuns = await bootstrapAgentRunRequests(tx, facts.value)
	if (!agentRuns.ok) return agentRuns
	const deliveries = await bootstrapDeliveryRequests(tx, facts.value.requests, facts.value.deliveries)
	if (!deliveries.ok) return deliveries

	const updated = await updateRecord('dispatch-coordination', tx.storage, coordination.value.id, { bootstrapVersion: 1 })
	if (updated.ok) return { ok: true, value: undefined }
	return updated.error.type === 'not-found'
		? { ok: false, error: { type: 'dispatch-storage-incompatible', summary: 'Dispatch Coordination disappeared.' } }
		: { ok: false, error: updated.error }
}

interface DispatchBootstrapFacts {
	requests: DispatchRequest[]
	agentRuns: AgentRun[]
	events: AgentRunEvent[]
	deliveries: Delivery[]
}

async function loadDispatchBootstrapFacts(tx: CoreTransaction): Promise<Result<DispatchBootstrapFacts, DispatchBootstrapError>> {
	const [requests, agentRuns, events, deliveries] = await Promise.all([
		listRecords('dispatch-request', tx.storage),
		listRecords('agent-run', tx.storage),
		listRecords('agent-run-event', tx.storage, { orderBy: [{ field: 'id', direction: 'asc' }] }),
		listRecords('delivery', tx.storage),
	])
	if (!requests.ok) return requests
	if (!agentRuns.ok) return agentRuns
	if (!events.ok) return events
	if (!deliveries.ok) return deliveries
	return { ok: true, value: { requests: requests.value, agentRuns: agentRuns.value, events: events.value, deliveries: deliveries.value } }
}

async function bootstrapAgentRunRequests(
	tx: CoreTransaction,
	facts: DispatchBootstrapFacts,
): Promise<Result<void, DispatchBootstrapError>> {
	for (const agentRun of facts.agentRuns) {
		const accepted = await bootstrapAgentRunRequest(tx, facts.requests, facts.events, agentRun)
		if (!accepted.ok) return accepted
	}
	return { ok: true, value: undefined }
}

async function bootstrapAgentRunRequest(
	tx: CoreTransaction,
	requests: DispatchRequest[],
	events: AgentRunEvent[],
	agentRun: AgentRun,
): Promise<Result<void, DispatchBootstrapError>> {
	if (agentRun.completed !== null) return bootstrapSandboxReleaseRequest(tx, requests, agentRun)
	if (agentRun.blocked?.type === 'preparation-pending' || agentRun.blocked?.type === 'preparation-failed') {
		const payload = { type: 'agent-run-preparation' as const, agentRunId: agentRun.id }
		if (blocksImplicitBootstrapRetry(requests, payload)) return { ok: true, value: undefined }
		const accepted = await tx.dispatch.request({
			payload,
			reason: { type: 'agent-run-created' },
			coordinationClaims: [exclusiveAgentRunClaim(agentRun.id)],
			deduplicationKey: { type: 'agent-run-preparation', agentRunId: agentRun.id },
		})
		return accepted.ok ? { ok: true, value: undefined } : accepted
	}
	return bootstrapModelTurnRequest(tx, requests, events, agentRun)
}

async function bootstrapSandboxReleaseRequest(
	tx: CoreTransaction,
	requests: DispatchRequest[],
	agentRun: AgentRun,
): Promise<Result<void, DispatchBootstrapError>> {
	if (agentRun.sandbox === null || agentRun.sandbox.released !== null) return { ok: true, value: undefined }
	const payload = { type: 'agent-run-sandbox-release' as const, agentRunId: agentRun.id }
	if (blocksImplicitBootstrapRetry(requests, payload)) return { ok: true, value: undefined }
	const accepted = await tx.dispatch.request({
		payload,
		reason: { type: 'agent-run-completed' },
		coordinationClaims: [exclusiveAgentRunClaim(agentRun.id)],
		deduplicationKey: { type: 'agent-run-sandbox-release', agentRunId: agentRun.id },
	})
	return accepted.ok ? { ok: true, value: undefined } : accepted
}

async function bootstrapModelTurnRequest(
	tx: CoreTransaction,
	requests: DispatchRequest[],
	events: AgentRunEvent[],
	agentRun: AgentRun,
): Promise<Result<void, DispatchBootstrapError>> {
	const payload = { type: 'agent-run-model-turn' as const, agentRunId: agentRun.id }
	const lastInput = events.findLast((event) => event.agentRunId === agentRun.id && event.body.type === 'input-message')
	const alreadyExists = requests.some(
		(request) =>
			request.payload.type === payload.type &&
			request.payload.agentRunId === payload.agentRunId &&
			request.lifecycle.type !== 'completed',
	)
	if (lastInput === undefined || alreadyExists || blocksImplicitBootstrapRetry(requests, payload)) {
		return { ok: true, value: undefined }
	}
	const accepted = await tx.dispatch.request({
		payload,
		reason: { type: 'input-appended', inputEventId: lastInput.id },
		coordinationClaims: [exclusiveAgentRunClaim(agentRun.id)],
		deduplicationKey: null,
	})
	return accepted.ok ? { ok: true, value: undefined } : accepted
}

async function bootstrapDeliveryRequests(
	tx: CoreTransaction,
	requests: DispatchRequest[],
	deliveries: Delivery[],
): Promise<Result<void, DispatchBootstrapError>> {
	for (const delivery of deliveries) {
		if (delivery.queued === null || delivery.closed !== null) continue
		const payload = { type: 'delivery-work-scheduler' as const, deliveryId: delivery.id }
		if (blocksImplicitBootstrapRetry(requests, payload)) continue
		const accepted = await tx.dispatch.request({
			payload,
			reason: { type: 'delivery-work-requested' },
			coordinationClaims: [exclusiveDeliverySchedulerClaim(delivery.id)],
			deduplicationKey: { type: 'delivery-work-scheduler', deliveryId: delivery.id },
		})
		if (!accepted.ok) return accepted
	}
	return { ok: true, value: undefined }
}

function blocksImplicitBootstrapRetry(requests: DispatchRequest[], payload: DispatchRequestPayload): boolean {
	return requests.some((request) => request.lifecycle.type === 'failed' && JSON.stringify(request.payload) === JSON.stringify(payload))
}

if (import.meta.vitest) {
	const { describe, expect, it, vi } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, seedDispatchRequest, testId } = await import('../utils/test-helpers')

	describe('Core Dispatch Processor', () => {
		it('validates options and rejects duplicate starts', async () => {
			const runtime = createTestCoreRuntime(createTestCoreServices())
			const api = createCoreDispatchApi(runtime, {
				router: () =>
					Promise.resolve({
						ok: true,
						value: {
							type: 'completed',
							outcome: 'processed',
							finalize: () => Promise.resolve({ ok: true, value: undefined }),
						},
					}),
			})

			expect(api.startProcessor({ heartbeatMs: 10, leaseMs: 20 })).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', operation: 'startDispatchProcessor' },
			})
			const started = api.startProcessor({ heartbeatMs: 1, leaseMs: 3, idlePollMinMs: 1, idlePollMaxMs: 2 })
			expect(started).toMatchObject({ ok: true })
			expect(api.startProcessor()).toEqual({ ok: false, error: { type: 'dispatch-processor-already-started' } })
			if (!started.ok) throw new Error('Expected processor start.')
			await expect(started.value.ready).resolves.toEqual({ ok: true, value: undefined })
			await started.value.stop()

			const restarted = api.startProcessor({ heartbeatMs: 1, leaseMs: 3, idlePollMinMs: 1, idlePollMaxMs: 2 })
			expect(restarted).toMatchObject({ ok: true })
			if (restarted.ok) {
				await expect(restarted.value.ready).resolves.toEqual({ ok: true, value: undefined })
				await restarted.value.stop()
			}
		})

		it('polls persisted requests without a wake and completes routed work', async () => {
			const options = createTestCoreServices()
			options.tx.dispatchCoordination.records.get('00000000000000000000000000')!.bootstrapVersion = 1
			const request = seedDispatchRequest(options.tx, testId(1))
			const runtime = createTestCoreRuntime(options)
			const api = createCoreDispatchApi(runtime, {
				random: () => 0,
				router: () =>
					Promise.resolve({
						ok: true,
						value: {
							type: 'completed',
							outcome: 'processed',
							finalize: () => Promise.resolve({ ok: true, value: undefined }),
						},
					}),
			})
			const started = api.startProcessor({
				heartbeatMs: 2,
				leaseMs: 6,
				idlePollMinMs: 1,
				idlePollMaxMs: 2,
				shutdownGraceMs: 10,
			})
			if (!started.ok) throw new Error('Expected processor start.')
			await expect(started.value.ready).resolves.toEqual({ ok: true, value: undefined })

			await vi.waitFor(() =>
				expect(options.tx.dispatchRequests.records.get(request.id)?.lifecycle).toMatchObject({ type: 'completed' }),
			)
			expect(started.value.status()).toMatchObject({ type: 'running' })
			await started.value.stop()
			expect(started.value.status()).toEqual({ type: 'stopped' })
			await expect(started.value.completed).resolves.toEqual({ ok: true, value: undefined })
		})

		it('terminally records a handler finalizer error instead of retrying it generically', async () => {
			const options = createTestCoreServices()
			options.tx.dispatchCoordination.records.get('00000000000000000000000000')!.bootstrapVersion = 1
			const request = seedDispatchRequest(options.tx, testId(1))
			const api = createCoreDispatchApi(createTestCoreRuntime(options), {
				router: () =>
					Promise.resolve({
						ok: true,
						value: {
							type: 'completed',
							outcome: 'processed',
							finalize: () => Promise.resolve({ ok: false, error: { type: 'handler-finalizer-failed' } }),
						},
					}),
			})
			const started = api.startProcessor({ heartbeatMs: 2, leaseMs: 6, idlePollMinMs: 1, idlePollMaxMs: 2 })
			if (!started.ok) throw new Error('Expected processor start.')

			await vi.waitFor(() => expect(options.tx.dispatchRequests.records.get(request.id)?.lifecycle).toMatchObject({ type: 'failed' }))
			expect([...options.tx.actions.records.values()].map((action) => action.result.type)).toEqual([
				'record-delivery-work-dispatch-failure',
			])
			await started.value.stop()
		})

		it('aborts and cleanly requeues an active attempt during stop', async () => {
			const options = createTestCoreServices()
			options.tx.dispatchCoordination.records.get('00000000000000000000000000')!.bootstrapVersion = 1
			const request = seedDispatchRequest(options.tx, testId(1))
			let observedAbort = false
			const api = createCoreDispatchApi(createTestCoreRuntime(options), {
				router: (attempt) =>
					new Promise((resolve) => {
						attempt.signal.addEventListener(
							'abort',
							() => {
								observedAbort = true
								resolve({
									ok: false,
									error: {
										type: 'dispatch-attempt-aborted',
										requestId: attempt.request.id,
										attemptNumber: attempt.attempt.number,
									},
								})
							},
							{ once: true },
						)
					}),
			})
			const started = api.startProcessor({
				heartbeatMs: 5,
				leaseMs: 15,
				idlePollMinMs: 1,
				idlePollMaxMs: 2,
				shutdownGraceMs: 20,
			})
			if (!started.ok) throw new Error('Expected processor start.')
			await vi.waitFor(() => expect(started.value.status()).toMatchObject({ type: 'running', activeAttempts: 1 }))

			await started.value.stop()

			expect(observedAbort).toBe(true)
			expect(options.tx.dispatchRequests.records.get(request.id)?.lifecycle).toMatchObject({ type: 'pending' })
		})

		it('does not start work when stopped during its initial scan', async () => {
			const options = createTestCoreServices()
			options.tx.dispatchCoordination.records.get('00000000000000000000000000')!.bootstrapVersion = 1
			const request = seedDispatchRequest(options.tx, testId(1))
			const router = vi.fn()
			const api = createCoreDispatchApi(createTestCoreRuntime(options), { router })
			const started = api.startProcessor({ heartbeatMs: 1, leaseMs: 3, idlePollMinMs: 1, idlePollMaxMs: 2 })
			if (!started.ok) throw new Error('Expected processor start.')

			await started.value.stop()

			await expect(started.value.ready).resolves.toEqual({ ok: true, value: undefined })
			expect(router).not.toHaveBeenCalled()
			expect(options.tx.dispatchRequests.records.get(request.id)?.lifecycle).toMatchObject({ type: 'pending' })
		})

		it('preserves failed status when startup fails concurrently with stop', async () => {
			const options = createTestCoreServices()
			options.tx.dispatchCoordination.fail.get = true
			options.tx.dispatchCoordination.fail.list = true
			const api = createCoreDispatchApi(createTestCoreRuntime(options))
			const started = api.startProcessor({ heartbeatMs: 1, leaseMs: 3, idlePollMinMs: 1, idlePollMaxMs: 2 })
			if (!started.ok) throw new Error('Expected processor start.')

			await started.value.stop()

			await expect(started.value.ready).resolves.toMatchObject({ ok: false, error: { type: 'storage-operation-failed' } })
			await expect(started.value.completed).resolves.toMatchObject({ ok: false, error: { type: 'storage-operation-failed' } })
			expect(started.value.status()).toMatchObject({ type: 'failed' })
		})

		it('stops fatally when persisted coordination is incompatible', async () => {
			const options = createTestCoreServices()
			options.tx.dispatchCoordination.records.clear()
			const api = createCoreDispatchApi(createTestCoreRuntime(options))
			const started = api.startProcessor({ heartbeatMs: 1, leaseMs: 3, idlePollMinMs: 1, idlePollMaxMs: 2 })
			if (!started.ok) throw new Error('Expected processor start.')

			await expect(started.value.ready).resolves.toEqual({
				ok: false,
				error: { type: 'dispatch-storage-incompatible', summary: 'Dispatch Coordination is missing.' },
			})
			await expect(started.value.completed).resolves.toEqual({
				ok: false,
				error: { type: 'dispatch-storage-incompatible', summary: 'Dispatch Coordination is missing.' },
			})
			expect(started.value.status()).toMatchObject({ type: 'failed' })
		})

		it('reports initial storage failure through ready for supervision retry', async () => {
			const options = createTestCoreServices()
			options.tx.dispatchCoordination.fail.get = true
			options.tx.dispatchCoordination.fail.list = true
			const api = createCoreDispatchApi(createTestCoreRuntime(options))
			const started = api.startProcessor({ heartbeatMs: 1, leaseMs: 3, idlePollMinMs: 1, idlePollMaxMs: 2 })
			if (!started.ok) throw new Error('Expected processor start.')

			await expect(started.value.ready).resolves.toMatchObject({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'get', resource: 'dispatch-coordination' } },
			})
			await expect(started.value.completed).resolves.toMatchObject({
				ok: false,
				error: { type: 'storage-operation-failed' },
			})
		})
	})
}
