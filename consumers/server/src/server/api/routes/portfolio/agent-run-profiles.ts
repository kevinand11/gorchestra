import { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import {
	agentRunProfileRequestSchema,
	portfolioRequestCookieSchema,
	type AgentRunProfileRequest,
	type PortfolioRequestCookies,
	type PaginatedQuery,
} from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore, withSelectedPortfolioOwnerCore } from '../../portfolio-context'
import { coreIdPipe } from '../../schemas'

export function createAgentRunProfilesApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/agent-run-profiles', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				query: Domain.Commons.paginatedQueryInputPipe,
				response: Queries.ListAgentRunProfiles.resultPipe,
			},
		})(async (req) => listSelectedPortfolioAgentRunProfiles(context, req.cookies, req.query))
		.post('/agent-run-profiles', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				body: agentRunProfileRequestSchema,
				response: Domain.AgentRunProfile.agentRunProfilePipe,
			},
		})(async (req) => createSelectedPortfolioAgentRunProfile(context, req.cookies, req.body))
		.get('/agent-run-profiles/:agentRunProfileId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ agentRunProfileId: coreIdPipe }),
				response: Queries.GetAgentRunProfile.resultPipe,
			},
		})(async (req) => getSelectedPortfolioAgentRunProfile(context, req.cookies, req.params.agentRunProfileId))
		.get('/agent-run-profiles/:agentRunProfileId/references', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ agentRunProfileId: coreIdPipe }),
				response: Queries.ListAgentRunProfileReferences.resultPipe,
			},
		})(async (req) => listSelectedPortfolioAgentRunProfileReferences(context, req.cookies, req.params.agentRunProfileId))
		.put('/agent-run-profiles/:agentRunProfileId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ agentRunProfileId: coreIdPipe }),
				body: agentRunProfileRequestSchema,
				response: Domain.AgentRunProfile.agentRunProfilePipe,
			},
		})(async (req) => updateSelectedPortfolioAgentRunProfile(context, req.cookies, req.params.agentRunProfileId, req.body))
		.post('/agent-run-profiles/:agentRunProfileId/archive', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ agentRunProfileId: coreIdPipe }),
				response: Domain.AgentRunProfile.agentRunProfilePipe,
			},
		})(async (req) => archiveSelectedPortfolioAgentRunProfile(context, req.cookies, req.params.agentRunProfileId))
		.post('/agent-run-profiles/:agentRunProfileId/unarchive', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ agentRunProfileId: coreIdPipe }),
				response: Domain.AgentRunProfile.agentRunProfilePipe,
			},
		})(async (req) => unarchiveSelectedPortfolioAgentRunProfile(context, req.cookies, req.params.agentRunProfileId))
}

function listSelectedPortfolioAgentRunProfiles(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	query: PaginatedQuery,
): Promise<Queries.ListAgentRunProfiles.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const profiles = await core.queries.listAgentRunProfiles(query)
		return profiles.ok ? profiles.value : throwCoreOperationError(profiles.error)
	})
}

function getSelectedPortfolioAgentRunProfile(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	agentRunProfileId: string,
): Promise<Queries.GetAgentRunProfile.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const profile = await core.queries.getAgentRunProfile({ agentRunProfileId })
		return profile.ok ? profile.value : throwCoreOperationError(profile.error)
	})
}

function listSelectedPortfolioAgentRunProfileReferences(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	agentRunProfileId: string,
): Promise<Queries.ListAgentRunProfileReferences.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const references = await core.queries.listAgentRunProfileReferences({ agentRunProfileId })
		return references.ok ? references.value : throwCoreOperationError(references.error)
	})
}

function createSelectedPortfolioAgentRunProfile(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	input: AgentRunProfileRequest,
): Promise<Domain.AgentRunProfile.AgentRunProfile> {
	return withSelectedPortfolioOwnerCore(context, cookies, async ({ core, workspaceMember }) => {
		const profile = await core.commands.createAgentRunProfile(input, {
			actor: { type: 'workspace-member', id: workspaceMember.id },
			correlationId: null,
		})
		return profile.ok ? profile.value : throwCoreOperationError(profile.error)
	})
}

function updateSelectedPortfolioAgentRunProfile(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	agentRunProfileId: string,
	input: AgentRunProfileRequest,
): Promise<Domain.AgentRunProfile.AgentRunProfile> {
	return withSelectedPortfolioOwnerCore(context, cookies, async ({ core, workspaceMember }) => {
		const profile = await core.commands.updateAgentRunProfile(
			{ agentRunProfileId, ...input },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return profile.ok ? profile.value : throwCoreOperationError(profile.error)
	})
}

function archiveSelectedPortfolioAgentRunProfile(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	agentRunProfileId: string,
): Promise<Domain.AgentRunProfile.AgentRunProfile> {
	return withSelectedPortfolioOwnerCore(context, cookies, async ({ core, workspaceMember }) => {
		const profile = await core.commands.archiveAgentRunProfile(
			{ agentRunProfileId },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return profile.ok ? profile.value : throwCoreOperationError(profile.error)
	})
}

function unarchiveSelectedPortfolioAgentRunProfile(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	agentRunProfileId: string,
): Promise<Domain.AgentRunProfile.AgentRunProfile> {
	return withSelectedPortfolioOwnerCore(context, cookies, async ({ core, workspaceMember }) => {
		const profile = await core.commands.unarchiveAgentRunProfile(
			{ agentRunProfileId },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return profile.ok ? profile.value : throwCoreOperationError(profile.error)
	})
}
