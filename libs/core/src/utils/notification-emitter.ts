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
