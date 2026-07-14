import type { IsoDateTime } from '../domain/commons'
import type { DispatchWaitingPrerequisite } from '../domain/dispatch-request'
import type { CoreTransaction } from '../utils/transactions'
import type { Result } from '../utils/types'

export type DispatchHandlerOutcome<E> =
	| {
			type: 'completed'
			outcome: 'processed' | 'stale-no-op' | 'no-longer-applicable'
			finalize(tx: CoreTransaction): Promise<Result<void, E>>
	  }
	| {
			type: 'waiting'
			prerequisite: DispatchWaitingPrerequisite
			finalize(tx: CoreTransaction): Promise<Result<void, E>>
	  }
	| {
			type: 'reschedule'
			eligibleAt: IsoDateTime
			category: string
			summary: string
			finalize(tx: CoreTransaction): Promise<Result<void, E>>
	  }
