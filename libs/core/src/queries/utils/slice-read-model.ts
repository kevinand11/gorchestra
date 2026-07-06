import type { Slice } from '../../domain/slice'
import type { CoreStorage } from '../../services'
import { listRecords, type StorageBoundaryError } from '../../storage/helpers'
import type { Result as CoreResult } from '../../utils/types'

export async function listOrderedDeliverySlices(
	storage: CoreStorage,
	deliveryId: string,
): Promise<CoreResult<Slice[], StorageBoundaryError>> {
	return await listRecords('slice', storage, {
		where: (filter, fields) => filter.eq(fields.deliveryId, deliveryId),
		orderBy: [
			{ field: 'order', direction: 'asc' },
			{ field: 'id', direction: 'asc' },
		],
	})
}
