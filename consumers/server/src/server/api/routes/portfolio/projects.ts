import { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import {
	createProjectRequestSchema,
	portfolioRequestCookieSchema,
	setProjectConfigRequestSchema,
	type CreateProjectRequest,
	type PortfolioRequestCookies,
	type SetProjectConfigRequest,
} from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore, withSelectedPortfolioOwnerCore } from '../../portfolio-context'
import { idPipe } from '../../schemas'

export function createProjectsApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/projects', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				query: Domain.Commons.paginatedQueryInputPipe,
				response: Queries.ListProjects.resultPipe,
			},
		})(async (req) =>
			withSelectedPortfolioCore(context, req.cookies, async ({ core }) => {
				const projects = await core.queries.listProjects(req.query)
				return projects.ok ? projects.value : throwCoreOperationError(projects.error)
			}),
		)
		.post('/projects', {
			schema: { cookies: portfolioRequestCookieSchema, body: createProjectRequestSchema, response: Queries.GetProject.resultPipe },
		})(async (req) => createSelectedPortfolioProject(context, req.cookies, req.body))
		.get('/projects/:projectId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe }),
				response: Queries.GetProject.resultPipe,
			},
		})(async (req) => getSelectedPortfolioProject(context, req.cookies, req.params.projectId))
		.put('/projects/:projectId/config', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ projectId: idPipe }),
				body: setProjectConfigRequestSchema,
				response: Queries.GetProject.resultPipe,
			},
		})(async (req) => setSelectedProjectConfig(context, req.cookies, req.params.projectId, req.body))
}

async function createSelectedPortfolioProject(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	input: CreateProjectRequest,
): Promise<Queries.ListProjects.ListedProject> {
	return withSelectedPortfolioOwnerCore(context, cookies, async ({ core, workspaceMember }) => {
		const project = await core.commands.createProject(
			{ title: input.title, source: { type: 'source-control' }, config: input.config },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return project.ok ? listedProjectFromCreatedProject(project.value) : throwCoreOperationError(project.error)
	})
}

function getSelectedPortfolioProject(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
): Promise<Queries.GetProject.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const project = await core.queries.getProject({ projectId })
		return project.ok ? project.value : throwCoreOperationError(project.error)
	})
}

function setSelectedProjectConfig(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	projectId: string,
	input: SetProjectConfigRequest,
): Promise<Queries.GetProject.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const saved = await core.commands.setProjectConfig(
			{ projectId, config: input.config },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		if (!saved.ok) return throwCoreOperationError(saved.error)

		const project = await core.queries.getProject({ projectId })
		return project.ok ? project.value : throwCoreOperationError(project.error)
	})
}

function listedProjectFromCreatedProject(project: Domain.Project.Project): Queries.ListProjects.ListedProject {
	return { ...project, source: { type: 'source-control', repositories: [] } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Portfolio API Projects', () => {
		it('returns newly-created Projects with the list item source shape', () => {
			const project: Domain.Project.Project = {
				id: 'project-1',
				title: 'Delivery Ops',
				source: { type: 'source-control' },
				config: {
					configured: { origin: 'imported', at: '2026-06-21T00:00:00.000Z' },
					value: {
						work: {
							maxProcessableSliceSlots: 1,
							maxCorrectionRetriesPerFailure: 1,
							executionAgentRunProfileId: 'agent-run-profile-1',
							revisionExecutionAgentRunProfileId: null,
						},
					},
				},
				created: { origin: 'imported', at: '2026-06-21T00:00:00.000Z' },
			}

			expect(listedProjectFromCreatedProject(project)).toEqual({
				...project,
				source: { type: 'source-control', repositories: [] },
			})
		})
	})
}
