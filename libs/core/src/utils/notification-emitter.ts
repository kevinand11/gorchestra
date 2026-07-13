import type { Notification } from '../domain/notifications'
import type { CoreNotificationsService } from '../services'
import { nextId, type CoreRuntimeValues } from './runtime-values'

export interface NotificationEmitter {
	emit(data: Notification['data']): void
}

export function createNotificationEmitter(values: CoreRuntimeValues, service: CoreNotificationsService | undefined): NotificationEmitter {
	return {
		emit: (data) => {
			if (service === undefined) return
			const id = nextId(values)
			if (!id.ok) return
			try {
				service.publish({ id: id.value, data })
			} catch {
				// Notification delivery is best-effort and cannot fail Core work.
			}
		},
	}
}

if (import.meta.vitest) {
	const { describe, expect, it, vi } = import.meta.vitest

	describe('createNotificationEmitter', () => {
		it('does not allocate a Notification Id when no Notifications service is configured', () => {
			const nextId = vi.fn(() => '01k00000000000000000000001')
			const emitter = createNotificationEmitter({ nextId, now: () => new Date() }, undefined)

			emitter.emit(testNotificationData())

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
				{ publish: (notification) => calls.push(`publish:${notification.id}`) },
			)

			emitter.emit(testNotificationData())
			emitter.emit(testNotificationData())

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

			expect(() => emitter.emit(testNotificationData())).not.toThrow()
		})

		it('drops a Notification when its id cannot be generated', () => {
			const publish = vi.fn()
			for (const nextId of [
				() => 'invalid',
				() => {
					throw new Error('id service unavailable')
				},
			]) {
				createNotificationEmitter({ nextId, now: () => new Date() }, { publish }).emit(testNotificationData())
			}

			expect(publish).not.toHaveBeenCalled()
		})
	})

	function testNotificationData(): Notification['data'] {
		return {
			type: 'assistant-message-draft-updated',
			agentRunId: '01k00000000000000000000002',
			turnStartedEventId: '01k00000000000000000000003',
			draftId: 'draft-1',
			delta: { type: 'model-output-started' },
		}
	}
}
