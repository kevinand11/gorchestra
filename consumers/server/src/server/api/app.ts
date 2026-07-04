import { Router } from 'equipped/server'
import { FastifyServer } from 'equipped/server/adapters/fastify'

import { ensureServerInstance } from '../instance'
import type { ServerApiContext } from './context'
import { createAuthApiRouter } from './routes/auth'
import { createPortfolioApiRouter } from './routes/portfolio'
import { createSelectionApiRouter } from './routes/selection'
import { createWorkspaceApiRouter } from './routes/workspace'

const buildServerApiRouter = (context: ServerApiContext) =>
	new Router({ path: '/api' })
		.nest(createAuthApiRouter(context))
		.nest(createWorkspaceApiRouter(context))
		.nest(createSelectionApiRouter(context))
		.nest(createPortfolioApiRouter(context))

export type ServerApiRouter = ReturnType<typeof buildServerApiRouter>

export function createServerApiRouter(context: ServerApiContext): ServerApiRouter {
	return buildServerApiRouter(context)
}

const buildServerApiServer = (context: ServerApiContext, port: number) => {
	ensureServerInstance()
	return FastifyServer.create({
		port,
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

export type ServerApiServer = ReturnType<typeof buildServerApiServer>

export function createServerApiServer(context: ServerApiContext, port: number): ServerApiServer {
	return buildServerApiServer(context, port)
}
