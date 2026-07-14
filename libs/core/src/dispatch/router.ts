import type { DispatchRequest } from '../domain/dispatch-request'
import { agentRunSandboxPrepared } from '../utils/agent-runs'
import type { CoreRuntime } from '../utils/runtime'
import { runtimeRecord } from '../utils/runtime-values'
import { getRequired } from '../utils/storage/helpers'
import type { CoreTransactions } from '../utils/transactions'
import type { Result } from '../utils/types'
import { createCoreWork, type Core as CoreWork } from '../work'
import { runDispatchTerminalFinalizers, runWithDispatchAttempt } from './attempt-context'
import type { DispatchAttemptController } from './fence'
import type { DispatchHandlerOutcome } from './handler'

export type DispatchRouterResult = Result<DispatchHandlerOutcome<unknown>, unknown>
export type DispatchRouter = (attempt: DispatchAttemptController) => Promise<DispatchRouterResult>

export function createDispatchRouter(runtime: CoreRuntime, work?: CoreWork): DispatchRouter {
	return (attempt) =>
		runWithDispatchAttempt(attempt, () =>
			routeDispatchRequest(
				runtime,
				work ??
					createCoreWork({
						...runtime,
						transactions: {
							run: ((operation: Parameters<CoreTransactions['run']>[0]) =>
								attempt.runWrite(operation)) as CoreTransactions['run'],
						},
					}),
				attempt,
			),
		)
}

async function routeDispatchRequest(
	runtime: CoreRuntime,
	work: CoreWork,
	attempt: DispatchAttemptController,
): Promise<DispatchRouterResult> {
	const request = attempt.request
	const context = { correlationId: request.id, signal: attempt.signal }
	switch (request.payload.type) {
		case 'agent-run-model-turn':
			return routeAgentRunModelTurn(runtime, work, attempt)
		case 'agent-run-preparation':
			return completedHandlerResult(
				attempt,
				await work.prepareAgentRun({ agentRunId: request.payload.agentRunId }, context),
				'processed',
			)
		case 'agent-run-sandbox-release':
			return routeAgentRunSandboxRelease(runtime, work, attempt)
		case 'delivery-work-scheduler':
			return completedHandlerResult(
				attempt,
				await work.scheduleDeliveryWork({ deliveryId: request.payload.deliveryId }, context),
				'processed',
			)
		case 'delivery-work-operation': {
			const result = await work.processDeliveryWorkOperation(
				{
					deliveryId: request.payload.deliveryId,
					requestId: request.id,
					attemptNumber: attempt.attempt.number,
					operationId: request.payload.operationId,
					operation: request.payload.operation,
				},
				context,
			)
			return completedHandlerResult(attempt, result, deliveryOperationOutcome(result))
		}
		default:
			throw new Error(`Unhandled Dispatch Request type: ${String(request.payload satisfies never)}`)
	}
}

async function routeAgentRunModelTurn(
	runtime: CoreRuntime,
	work: CoreWork,
	attempt: DispatchAttemptController,
): Promise<DispatchRouterResult> {
	const payload = attempt.request.payload
	if (payload.type !== 'agent-run-model-turn') throw new Error('Expected Agent Run Model Turn request.')
	const agentRun = await getRequired('agent-run', runtime.services.storage, payload.agentRunId)
	if (!agentRun.ok) return agentRun
	if (agentRun.value.completed !== null) {
		return completedHandlerResult(attempt, { ok: true, value: undefined }, 'no-longer-applicable')
	}
	if (!agentRunSandboxPrepared(agentRun.value)) {
		return {
			ok: true,
			value: {
				type: 'waiting',
				prerequisite: { type: 'agent-run-preparation', agentRunId: agentRun.value.id },
				finalize: () => Promise.resolve({ ok: true, value: undefined }),
			},
		}
	}
	return completedHandlerResult(
		attempt,
		await work.runModelAgentRun({ agentRunId: payload.agentRunId }, { correlationId: attempt.request.id, signal: attempt.signal }),
		'processed',
	)
}

async function routeAgentRunSandboxRelease(
	runtime: CoreRuntime,
	work: CoreWork,
	attempt: DispatchAttemptController,
): Promise<DispatchRouterResult> {
	const payload = attempt.request.payload
	if (payload.type !== 'agent-run-sandbox-release') throw new Error('Expected Agent Run Sandbox Release request.')
	const result = await work.releaseAgentRunSandbox(
		{ agentRunId: payload.agentRunId },
		{ correlationId: attempt.request.id, signal: attempt.signal },
	)
	if (!result.ok) return result
	const agentRun = await getRequired('agent-run', runtime.services.storage, payload.agentRunId)
	if (!agentRun.ok) return agentRun
	if (agentRun.value.sandbox === null || agentRun.value.sandbox.released !== null) {
		return completedHandlerResult(attempt, result, 'processed')
	}

	const handledAttempts = attempt.request.attempts.filter((entry) => entry.outcome.type === 'rescheduled').length + 1
	if (handledAttempts >= 10) return { ok: false, error: { type: 'sandbox-release-policy-exhausted' } }
	const now = runtimeRecord(runtime.values)
	if (!now.ok) return now
	const maximumDelay = Math.min(5 * 60_000, 1_000 * 2 ** (handledAttempts - 1))
	return {
		ok: true,
		value: {
			type: 'reschedule',
			eligibleAt: new Date(Date.parse(now.value.at) + Math.floor(Math.random() * maximumDelay)).toISOString(),
			category: 'sandbox-release-retry',
			summary: 'Agent Run sandbox release will be retried.',
			finalize: () => Promise.resolve({ ok: true, value: undefined }),
		},
	}
}

function completedHandlerResult(
	attempt: DispatchAttemptController,
	result: Result<unknown, unknown>,
	outcome: 'processed' | 'stale-no-op' | 'no-longer-applicable',
): DispatchRouterResult {
	return result.ok
		? {
				ok: true,
				value: {
					type: 'completed',
					outcome,
					finalize: (tx) => runDispatchTerminalFinalizers(attempt, tx),
				},
			}
		: result
}

function deliveryOperationOutcome(result: Result<unknown, unknown>): 'processed' | 'stale-no-op' {
	return result.ok &&
		typeof result.value === 'object' &&
		result.value !== null &&
		'processedCount' in result.value &&
		result.value.processedCount === 0
		? 'stale-no-op'
		: 'processed'
}

if (import.meta.vitest) {
	const { describe, expect, it, vi } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, seedDispatchRequest, testId, testModelAgentRun } =
		await import('../utils/test-helpers')

	describe('Dispatch router', () => {
		it('routes all five payload variants through one exhaustive boundary', async () => {
			const options = createTestCoreServices()
			const agentRun = testModelAgentRun({ id: testId(2) })
			options.tx.agentRuns.records.set(agentRun.id, {
				...agentRun,
				blocked: null,
				sandbox: {
					key: agentRun.id,
					created: agentRun.started,
					released: null,
					appliedRequirements: [],
					appliedThroughEventId: null,
				},
			})
			const runtime = createTestCoreRuntime(options)
			const calls: string[] = []
			const succeeded = (name: string) => {
				calls.push(name)
				return Promise.resolve({ ok: true as const, value: undefined })
			}
			const work = {
				runModelAgentRun: vi.fn(() => succeeded('model-turn')),
				prepareAgentRun: vi.fn(() => succeeded('preparation')),
				releaseAgentRunSandbox: vi.fn(() => {
					const stored = options.tx.agentRuns.records.get(agentRun.id)
					if (stored?.sandbox !== null && stored?.sandbox !== undefined) {
						stored.sandbox.released = { at: '2026-06-10T12:00:00.000Z' }
					}
					return succeeded('release')
				}),
				scheduleDeliveryWork: vi.fn(() => succeeded('scheduler')),
				processDeliveryWorkOperation: vi.fn(() => succeeded('operation')),
			} as unknown as CoreWork
			const router = createDispatchRouter(runtime, work)
			const payloads: DispatchRequest['payload'][] = [
				{ type: 'agent-run-model-turn', agentRunId: testId(2) },
				{ type: 'agent-run-preparation', agentRunId: testId(2) },
				{ type: 'agent-run-sandbox-release', agentRunId: testId(2) },
				{ type: 'delivery-work-scheduler', deliveryId: testId(8) },
				{
					type: 'delivery-work-operation',
					deliveryId: testId(8),
					operationId: testId(9),
					operation: { scope: 'delivery', state: 'needs-artifact-creation' },
				},
			]

			for (const [index, payload] of payloads.entries()) {
				const request = seedDispatchRequest(options.tx, testId(100 + index), { payload })
				const attempt = {
					number: 1,
					token: 'token',
					coordinationEpoch: 0,
					claimed: request.accepted,
					heartbeat: request.accepted,
					expiresAt: request.accepted.at,
				}
				const result = await router({
					request,
					attempt,
					signal: new AbortController().signal,
					runWrite: () => Promise.reject(new Error('not used')),
					commitOutcome: () => Promise.reject(new Error('not used')),
				})
				expect(result).toMatchObject({ ok: true, value: { type: 'completed' } })
			}

			expect(calls).toEqual(['model-turn', 'preparation', 'release', 'scheduler', 'operation'])
			expect(work.processDeliveryWorkOperation).toHaveBeenCalledWith(
				expect.objectContaining({ operationId: testId(9) }),
				expect.anything(),
			)
		})
	})
}
