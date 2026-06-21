import { Router } from 'equipped/server'
import { FastifyServer } from 'equipped/server/adapters/fastify'

import type { ServerEnv } from '../env'
import { ensureServerInstance } from '../instance'
import type { ServerApiContext } from './context'
import { createAuthApiRouter } from './routes/auth'
import { createPortfolioApiRouter } from './routes/portfolio'
import { createSelectionApiRouter } from './routes/selection'
import { createWorkspaceApiRouter } from './routes/workspace'

export function createServerApiRouter(context: ServerApiContext) {
	return new Router({ path: '/api' })
		.nest(createAuthApiRouter(context))
		.nest(createWorkspaceApiRouter(context))
		.nest(createSelectionApiRouter(context))
		.nest(createPortfolioApiRouter(context))
}

export function createServerApiServer(context: ServerApiContext, env: ServerEnv) {
	ensureServerInstance()
	return FastifyServer.create({
		port: env.GORCHESTRA_PORT,
		cors: { origin: true, credentials: true },
		healthPath: '/api/health',
		openapi: { docsPath: '/api/__docs' },
		requests: {
			log: false,
			rateLimit: { enabled: false },
			slowdown: { enabled: false },
		},
	}).addRouter(createServerApiRouter(context))
}
