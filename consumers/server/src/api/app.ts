import { Router, type RouteDef } from 'equipped/server'
import { FastifyServer } from 'equipped/server/adapters/fastify'

import { createAuthApiRouter } from './auth-routes'
import type { ServerApiContext } from './context'
import { createSelectionApiRouter } from './selection-routes'
import { createWorkspaceApiRouter } from './workspace-routes'
import type { ServerEnv } from '../env'
import { ensureServerInstance } from '../instance'

export function createServerApiRouter(context: ServerApiContext): Router<RouteDef> {
	const router = new Router()
	router.nest(createAuthApiRouter(context), createWorkspaceApiRouter(context), createSelectionApiRouter(context))
	return router
}

export function createServerApiServer(context: ServerApiContext, env: ServerEnv): FastifyServer {
	ensureServerInstance()
	const server = FastifyServer.create({
		port: env.GORCHESTRA_API_PORT,
		healthPath: '/api/health',
		requests: {
			log: process.env.NODE_ENV !== 'test',
			rateLimit: { enabled: false },
			slowdown: { enabled: false },
		},
	})
	server.addRouter(createServerApiRouter(context))
	return server
}
