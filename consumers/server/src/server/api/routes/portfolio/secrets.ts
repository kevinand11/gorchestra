import { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import {
	createSecretRequestSchema,
	portfolioRequestCookieSchema,
	type CreateSecretRequest,
	type PaginatedQuery,
	type PortfolioRequestCookies,
} from './shared'
import { protectSecretPlaintext } from '../../../modules/secret-protection'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { withSelectedPortfolioCore } from '../../portfolio-context'
import { idPipe } from '../../schemas'

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
				params: v.object({ secretId: idPipe }),
				response: Queries.GetSecret.resultPipe,
			},
		})(async (req) => getSelectedPortfolioSecret(context, req.cookies, req.params.secretId))
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
		const secret = await core.commands.createSecret(
			{ name: input.name, valueRef },
			{ actor: { type: 'workspace-member', id: workspaceMember.id }, correlationId: null },
		)
		return secret.ok ? secretResponseFromCreatedSecret(secret.value) : throwCoreOperationError(secret.error)
	})
}

function secretResponseFromCreatedSecret(secret: Domain.Secret.Secret): Queries.GetSecret.Result {
	return { id: secret.id, name: secret.name, created: secret.created, replaced: secret.replaced, archived: false, references: [] }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Portfolio API Secrets', () => {
		it('redacts protected value refs from newly-created Secret responses', () => {
			const secret: Domain.Secret.Secret = {
				id: 'secret-1',
				name: 'GitHub PAT',
				valueRef: 'gorchestra-secret-value:v1:encrypted',
				created: { origin: 'imported', at: '2026-06-21T00:00:00.000Z' },
				replaced: null,
				archivePeriods: [],
			}

			expect(secretResponseFromCreatedSecret(secret)).toEqual({
				id: 'secret-1',
				name: 'GitHub PAT',
				created: secret.created,
				replaced: null,
				archived: false,
				references: [],
			})
		})
	})
}
