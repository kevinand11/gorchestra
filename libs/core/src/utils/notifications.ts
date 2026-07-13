import type { Notification } from '../domain/notifications'
import type { StorageOperationFailedError } from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { createNotificationEmitter, type NotificationEmitter } from './notification-emitter'
import { withTransaction } from './storage/transactions'
import type { Result } from './types'

export { createNotificationEmitter, type NotificationEmitter } from './notification-emitter'

type NotificationData = Notification['data']

export async function withNotificationTransaction<TValue, TError>(
	runtime: { services: Pick<CoreServices, 'storage'>; notifications: NotificationEmitter },
	run: (storage: CoreStorage, notifications: NotificationEmitter) => Promise<Result<TValue, TError>>,
): Promise<Result<TValue, TError | StorageOperationFailedError>> {
	const pending: NotificationData[] = []
	const result = await withTransaction(runtime.services, (storage) => run(storage, { emit: (data) => pending.push(data) }))
	if (!result.ok) return result

	for (const data of pending) runtime.notifications.emit(data)
	return result
}

if (import.meta.vitest) {
	const { describe, expect, it, vi } = import.meta.vitest
	const { createTestCoreServices, defaultAgentRunSandboxConfig } = await import('./test-helpers')
	const { createRecord } = await import('./storage/helpers')

	describe('createNotificationEmitter', () => {
		it('does not allocate a Notification Id when no Notifications service is configured', () => {
			const nextId = vi.fn(() => '01k00000000000000000000001')
			const emitter = createNotificationEmitter({ nextId, now: () => new Date() }, undefined)

			emitter.emit({ type: 'agent-run-created', agentRun: testAgentRun() })

			expect(nextId).not.toHaveBeenCalled()
		})

		it('allocates an id immediately before publishing each Notification', () => {
			const calls: string[] = []
			let sequence = 0
			const emitter = createNotificationEmitter(
				{
					nextId: () => {
						calls.push('id')
						sequence += 1
						return `01k0000000000000000000000${sequence}`
					},
					now: () => new Date(),
				},
				{
					publish: (notification) => {
						calls.push(`publish:${notification.id}`)
					},
				},
			)

			emitter.emit({ type: 'agent-run-created', agentRun: testAgentRun() })
			emitter.emit({ type: 'agent-run-updated', agentRun: testAgentRun() })

			expect(calls).toEqual(['id', 'publish:01k00000000000000000000001', 'id', 'publish:01k00000000000000000000002'])
		})

		it('does not let a Notifications publisher failure escape into Core work', () => {
			const emitter = createNotificationEmitter(
				{ nextId: () => '01k00000000000000000000001', now: () => new Date() },
				{
					publish: () => {
						throw new Error('publisher unavailable')
					},
				},
			)

			expect(() => emitter.emit({ type: 'agent-run-created', agentRun: testAgentRun() })).not.toThrow()
		})

		it('drops a Notification when its id cannot be generated', () => {
			const publish = vi.fn()
			for (const nextId of [
				() => 'invalid',
				() => {
					throw new Error('id service unavailable')
				},
			]) {
				const emitter = createNotificationEmitter({ nextId, now: () => new Date() }, { publish })
				emitter.emit({ type: 'agent-run-created', agentRun: testAgentRun() })
			}

			expect(publish).not.toHaveBeenCalled()
		})
	})

	describe('withNotificationTransaction', () => {
		it('publishes queued data in write order only after the transaction commits', async () => {
			const services = createTestCoreServices()
			const calls: string[] = []
			const runtime = {
				services,
				notifications: {
					emit: (data: NotificationData) => {
						calls.push(`${services.tx.projects.records.has('01k00000000000000000000030') ? 'committed' : 'open'}:${data.type}`)
					},
				},
			}

			const result = await withNotificationTransaction(runtime, async (storage, notifications) => {
				const created = await createRecord('project', storage, {
					id: '01k00000000000000000000030',
					title: 'Project',
					source: { type: 'source-control' },
					config: {
						configured: testStamp(),
						value: {
							work: {
								maxProcessableSliceSlots: 1,
								maxCorrectionRetriesPerFailure: 1,
								executionAgentRunProfileId: '01k00000000000000000000004',
								revisionExecutionAgentRunProfileId: null,
							},
						},
					},
					created: testStamp(),
				})
				if (!created.ok) return created
				notifications.emit({ type: 'agent-run-created', agentRun: testAgentRun() })
				notifications.emit({ type: 'agent-run-updated', agentRun: testAgentRun() })
				calls.push('run-finished')
				return { ok: true, value: created.value.id }
			})

			expect(result).toEqual({ ok: true, value: '01k00000000000000000000030' })
			expect(calls).toEqual(['run-finished', 'committed:agent-run-created', 'committed:agent-run-updated'])
		})

		it('discards queued data when a transaction rolls back', async () => {
			const services = createTestCoreServices()
			const emit = vi.fn()
			const result = await withNotificationTransaction({ services, notifications: { emit } }, (_storage, notifications) => {
				notifications.emit({ type: 'agent-run-created', agentRun: testAgentRun() })
				return Promise.resolve({ ok: false, error: { type: 'expected-failure' as const } })
			})

			expect(result).toEqual({ ok: false, error: { type: 'expected-failure' } })
			expect(emit).not.toHaveBeenCalled()
		})

		it('does not allocate Notification ids while a transaction is open', async () => {
			const services = createTestCoreServices()
			const nextId = vi.fn(() => '01k00000000000000000000001')
			const publish = vi.fn()
			const notifications = createNotificationEmitter({ nextId, now: () => new Date() }, { publish })

			await withNotificationTransaction({ services, notifications }, (_storage, pending) => {
				pending.emit({ type: 'agent-run-created', agentRun: testAgentRun() })
				expect(nextId).not.toHaveBeenCalled()
				return Promise.resolve({ ok: true, value: undefined })
			})

			expect(nextId).toHaveBeenCalledOnce()
			expect(publish).toHaveBeenCalledOnce()
		})
	})

	function testStamp() {
		return {
			origin: 'local' as const,
			at: '2026-06-10T12:00:00.000Z',
			actor: { type: 'local-user', id: 'actor-1' },
			correlationId: 'correlation-1',
		}
	}

	function testAgentRun(): Extract<NotificationData, { type: 'agent-run-created' }>['agentRun'] {
		return {
			id: '01k00000000000000000000002',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: '01k00000000000000000000003' },
			profile: {
				agentRunProfileId: '01k00000000000000000000004',
				name: 'Profile',
				modelUse: { modelId: '01k00000000000000000000005', thinkingLevel: 'none' },
				runtimeRequirements: [],
				sandboxConfig: defaultAgentRunSandboxConfig(),
			},
			toolSet: [],
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: { type: 'preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
			sandbox: null,
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
	}
}
