import { Router } from 'equipped/server'

import { createDeliveriesApiRouter } from './deliveries'
import { createMemoriesApiRouter } from './memories'
import { createPlansApiRouter } from './plans'
import { createProjectsApiRouter } from './projects'
import { createRepositoriesApiRouter } from './repositories'
import { createSecretsApiRouter } from './secrets'
import type { ServerApiContext } from '../../context'

export function createPortfolioApiRouter(context: ServerApiContext) {
	return new Router({ path: '/portfolio' })
		.nest(createProjectsApiRouter(context))
		.nest(createPlansApiRouter(context))
		.nest(createDeliveriesApiRouter(context))
		.nest(createMemoriesApiRouter(context))
		.nest(createRepositoriesApiRouter(context))
		.nest(createSecretsApiRouter(context))
}
