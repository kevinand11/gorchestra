import { Router, type RouteDef } from 'equipped/server'
import { v } from 'valleyed'

import { selectionCookieName } from '../../modules/selection-cookie'
import type { ServerApiContext } from '../context'
import { throwCoreOperationError } from '../errors'
import { optionalCookiePipe } from '../http'
import { withSelectedPortfolioCore } from '../portfolio-context'
import { portfolioProjectsResponseSchema } from '../schemas'
import { sessionCookieSchema } from '../session'

const selectionCookieSchema = optionalCookiePipe(selectionCookieName)
const portfolioRequestCookieSchema = v.merge(sessionCookieSchema, selectionCookieSchema)

export function createPortfolioApiRouter(context: ServerApiContext): Router<RouteDef> {
	const router = new Router({ path: '/portfolio' })

	router.get('/projects', { schema: { cookies: portfolioRequestCookieSchema, response: portfolioProjectsResponseSchema } })(async (req) =>
		withSelectedPortfolioCore(context, req.cookies, async ({ core }) => {
			const projects = await core.queries.listProjects({})
			return projects.ok ? projects.value : throwCoreOperationError(projects.error)
		}),
	)

	return router
}
