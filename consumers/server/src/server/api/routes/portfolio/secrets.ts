import { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import {
	createSecretRequestSchema,
	portfolioRequestCookieSchema,
	replaceSecretValueRequestSchema,
	updateSecretMetadataRequestSchema,
	type CreateSecretRequest,
	type PaginatedQuery,
	type PortfolioRequestCookies,
	type ReplaceSecretValueRequest,
	type UpdateSecretMetadataRequest,
} from './shared'
import { protectSecretPlaintext } from '../../../modules/secret-protection'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { type SelectedPortfolioCoreContext, withSelectedPortfolioCore } from '../../portfolio-context'
import { coreIdPipe } from '../../schemas'

export function createSecretsApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/secrets', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				query: Domain.Commons.paginatedQueryInputPipe,
				response: Queries.ListSecrets.resultPipe,
			},
		})(async (req) => listSelectedPortfolioSecrets(context, req.cookies, req.query))
		.post('/secrets', {
			schema: { cookies: portfolioRequestCookieSchema, body: createSecretRequestSchema, response: Queries.GetSecret.resultPipe },
		})(async (req) => createSelectedPortfolioSecret(context, req.cookies, req.body))
		.get('/secrets/:secretId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ secretId: coreIdPipe }),
				response: Queries.GetSecret.resultPipe,
			},
		})(async (req) => getSelectedPortfolioSecret(context, req.cookies, req.params.secretId))
		.put('/secrets/:secretId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ secretId: coreIdPipe }),
				body: updateSecretMetadataRequestSchema,
				response: Queries.GetSecret.resultPipe,
			},
		})(async (req) => updateSelectedPortfolioSecretMetadata(context, req.cookies, req.params.secretId, req.body))
		.post('/secrets/:secretId/value', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ secretId: coreIdPipe }),
				body: replaceSecretValueRequestSchema,
				response: Queries.GetSecret.resultPipe,
			},
		})(async (req) => replaceSelectedPortfolioSecretValue(context, req.cookies, req.params.secretId, req.body))
		.post('/secrets/:secretId/archive', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ secretId: coreIdPipe }),
				response: Queries.GetSecret.resultPipe,
			},
		})(async (req) => archiveSelectedPortfolioSecret(context, req.cookies, req.params.secretId))
		.post('/secrets/:secretId/unarchive', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ secretId: coreIdPipe }),
				response: Queries.GetSecret.resultPipe,
			},
		})(async (req) => unarchiveSelectedPortfolioSecret(context, req.cookies, req.params.secretId))
}

function listSelectedPortfolioSecrets(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	query: PaginatedQuery,
): Promise<Queries.ListSecrets.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const secrets = await core.queries.listSecrets(query)
		return secrets.ok ? secrets.value : throwCoreOperationError(secrets.error)
	})
}

function getSelectedPortfolioSecret(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	secretId: string,
): Promise<Queries.GetSecret.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const secret = await core.queries.getSecret({ secretId })
		return secret.ok ? secret.value : throwCoreOperationError(secret.error)
	})
}

function createSelectedPortfolioSecret(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	input: CreateSecretRequest,
): Promise<Queries.GetSecret.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const valueRef = protectSecretPlaintext(input.value, context.security.secretEncryptionKey)
		const secret = await core.commands.createSecret({ name: input.name, valueRef }, commandContext(workspaceMember.id))
		return secret.ok ? getSecretResponse(core, secret.value.id) : throwCoreOperationError(secret.error)
	})
}

function updateSelectedPortfolioSecretMetadata(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	secretId: string,
	input: UpdateSecretMetadataRequest,
): Promise<Queries.GetSecret.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const secret = await core.commands.updateSecretMetadata({ secretId, name: input.name }, commandContext(workspaceMember.id))
		return secret.ok ? getSecretResponse(core, secret.value.id) : throwCoreOperationError(secret.error)
	})
}

function replaceSelectedPortfolioSecretValue(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	secretId: string,
	input: ReplaceSecretValueRequest,
): Promise<Queries.GetSecret.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const valueRef = protectSecretPlaintext(input.value, context.security.secretEncryptionKey)
		const secret = await core.commands.replaceSecretValue({ secretId, valueRef }, commandContext(workspaceMember.id))
		return secret.ok ? getSecretResponse(core, secret.value.id) : throwCoreOperationError(secret.error)
	})
}

function archiveSelectedPortfolioSecret(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	secretId: string,
): Promise<Queries.GetSecret.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const secret = await core.commands.archiveSecret({ secretId }, commandContext(workspaceMember.id))
		return secret.ok ? getSecretResponse(core, secret.value.id) : throwCoreOperationError(secret.error)
	})
}

function unarchiveSelectedPortfolioSecret(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	secretId: string,
): Promise<Queries.GetSecret.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const secret = await core.commands.unarchiveSecret({ secretId }, commandContext(workspaceMember.id))
		return secret.ok ? getSecretResponse(core, secret.value.id) : throwCoreOperationError(secret.error)
	})
}

async function getSecretResponse(core: SelectedPortfolioCoreContext['core'], secretId: string): Promise<Queries.GetSecret.Result> {
	const secret = await core.queries.getSecret({ secretId })
	return secret.ok ? secret.value : throwCoreOperationError(secret.error)
}

function commandContext(workspaceMemberId: string) {
	return { actor: { type: 'workspace-member', id: workspaceMemberId }, correlationId: null }
}
