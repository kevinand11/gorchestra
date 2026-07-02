type DeliveryStateInput = {
	closed: { type: 'shipped' | 'abandoned' } | null
	queued: object | null
}

export type DeliveryState = 'accepted' | 'queued' | 'shipped' | 'abandoned'

export function deliveryStateForDisplay(delivery: DeliveryStateInput | null): DeliveryState {
	if (delivery === null) return 'accepted'
	if (delivery.closed) return delivery.closed.type
	return delivery.queued === null ? 'accepted' : 'queued'
}
