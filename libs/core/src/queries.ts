import type { Pipe } from 'valleyed'

import { getDeliveryWorkStateArgumentsPipe, getSliceWorkStateArgumentsPipe } from './boundary-pipes'
import type { WorkStateQueryError } from './errors'
import type { DeliveryWorkState, SliceWorkState } from './model'
import type { Result } from './result'

export interface CoreQueries {
	getDeliveryWorkState(
		deliveryId: ParametersFromPipe<typeof getDeliveryWorkStateArgumentsPipe>[0],
	): Promise<Result<DeliveryWorkState, GetDeliveryWorkStateError>>
	getSliceWorkState(
		sliceId: ParametersFromPipe<typeof getSliceWorkStateArgumentsPipe>[0],
	): Promise<Result<SliceWorkState, GetSliceWorkStateError>>
}

export type GetDeliveryWorkStateError = WorkStateQueryError
export type GetSliceWorkStateError = WorkStateQueryError

export const queryArgumentPipes = {
	getDeliveryWorkState: getDeliveryWorkStateArgumentsPipe,
	getSliceWorkState: getSliceWorkStateArgumentsPipe,
} satisfies Record<keyof CoreQueries, Pipe<unknown, unknown>>

type ParametersFromPipe<TPipe extends Pipe<unknown, readonly unknown[]>> = TPipe extends Pipe<unknown, infer TArgs> ? TArgs : never
