import type { RouteContractOf } from 'equipped/server'

import type { createServerApiRouter } from '../server/api/app'

export type ServerApiRouteContract = RouteContractOf<ReturnType<typeof createServerApiRouter>>
