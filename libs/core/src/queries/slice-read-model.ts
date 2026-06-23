import type { Slice } from '../domain/slice'
import type { CoreStorage } from '../services'
import { listRecords, type StorageBoundaryError } from '../utils/storage'
import type { Result as CoreResult } from '../utils/types'

export async function listOrderedDeliverySlices(
	storage: CoreStorage,
	deliveryId: string,
): Promise<CoreResult<Slice[], StorageBoundaryError>> {
	const slices = await listRecords('slice', storage, { where: (filter, fields) => filter.eq(fields.deliveryId, deliveryId) })
	return slices.ok ? { ok: true, value: sortSlicesByOrderThenId(slices.value) } : slices
}

function sortSlicesByOrderThenId(slices: Slice[]): Slice[] {
	return [...slices].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}
