type DeliveryStateInput = {
	closed: { type: 'shipped' | 'abandoned' } | null
	queued: object | null
}

export type DeliveryState = 'accepted' | 'queued' | 'shipped' | 'abandoned'

export function deliveryStateForDisplay(delivery: DeliveryStateInput | null): DeliveryState {
	if (delivery === null) return 'accepted'
	return delivery.closed?.type ?? queueState(delivery.queued)
}

function queueState(queued: object | null): 'accepted' | 'queued' {
	return queued === null ? 'accepted' : 'queued'
}
