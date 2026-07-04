import { Router } from 'equipped/server'

import { createAgentRunProfilesApiRouter } from './agent-run-profiles'
import { createAgentRunsApiRouter } from './agent-runs'
import { createDeliveriesApiRouter } from './deliveries'
import { createMemoriesApiRouter } from './memories'
import { createModelProvidersApiRouter } from './model-providers'
import { createPlansApiRouter } from './plans'
import { createProjectsApiRouter } from './projects'
import { createRepositoriesApiRouter } from './repositories'
import { createSecretsApiRouter } from './secrets'
import type { ServerApiContext } from '../../context'

const buildPortfolioApiRouter = (context: ServerApiContext) =>
	new Router({ path: '/portfolio' })
		.nest(createAgentRunsApiRouter(context))
		.nest(createAgentRunProfilesApiRouter(context))
		.nest(createModelProvidersApiRouter(context))
		.nest(createProjectsApiRouter(context))
		.nest(createPlansApiRouter(context))
		.nest(createDeliveriesApiRouter(context))
		.nest(createMemoriesApiRouter(context))
		.nest(createRepositoriesApiRouter(context))
		.nest(createSecretsApiRouter(context))

export type PortfolioApiRouter = ReturnType<typeof buildPortfolioApiRouter>

export function createPortfolioApiRouter(context: ServerApiContext): PortfolioApiRouter {
	return buildPortfolioApiRouter(context)
}
