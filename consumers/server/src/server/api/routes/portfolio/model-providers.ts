import { Domain, Queries } from '@gorchestra/core'
import { Router } from 'equipped/server'
import { v } from 'valleyed'

import {
	createModelProviderRequestSchema,
	createModelRequestSchema,
	portfolioRequestCookieSchema,
	updateModelProviderRequestSchema,
	updateModelRequestSchema,
	type CreateModelProviderRequest,
	type CreateModelRequest,
	type PortfolioRequestCookies,
	type PaginatedQuery,
	type UpdateModelProviderRequest,
	type UpdateModelRequest,
} from './shared'
import type { ServerApiContext } from '../../context'
import { throwCoreOperationError } from '../../errors'
import { type SelectedPortfolioCoreContext, withSelectedPortfolioCore } from '../../portfolio-context'
import { coreIdPipe } from '../../schemas'

export function createModelProvidersApiRouter(context: ServerApiContext) {
	return new Router()
		.get('/model-providers', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				query: Domain.Commons.paginatedQueryInputPipe,
				response: Queries.ListModelProviders.resultPipe,
			},
		})(async (req) => listSelectedModelProviders(context, req.cookies, req.query))
		.post('/model-providers', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				body: createModelProviderRequestSchema,
				response: Domain.ModelProvider.modelProviderPipe,
			},
		})(async (req) => createSelectedModelProvider(context, req.cookies, req.body))
		.get('/model-providers/:modelProviderId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ modelProviderId: coreIdPipe }),
				response: Queries.GetModelProvider.resultPipe,
			},
		})(async (req) => getSelectedModelProvider(context, req.cookies, req.params.modelProviderId))
		.get('/model-providers/:modelProviderId/models/:modelId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ modelProviderId: coreIdPipe, modelId: coreIdPipe }),
				response: Queries.GetModel.resultPipe,
			},
		})(async (req) => getSelectedModel(context, req.cookies, req.params.modelProviderId, req.params.modelId))
		.get('/model-providers/:modelProviderId/models/:modelId/references', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ modelProviderId: coreIdPipe, modelId: coreIdPipe }),
				response: Queries.ListModelReferences.resultPipe,
			},
		})(async (req) => listSelectedModelReferences(context, req.cookies, req.params.modelProviderId, req.params.modelId))
		.put('/model-providers/:modelProviderId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ modelProviderId: coreIdPipe }),
				body: updateModelProviderRequestSchema,
				response: Domain.ModelProvider.modelProviderPipe,
			},
		})(async (req) => updateSelectedModelProvider(context, req.cookies, req.params.modelProviderId, req.body))
		.post('/model-providers/:modelProviderId/archive', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ modelProviderId: coreIdPipe }),
				response: Domain.ModelProvider.modelProviderPipe,
			},
		})(async (req) => archiveSelectedModelProvider(context, req.cookies, req.params.modelProviderId))
		.post('/model-providers/:modelProviderId/unarchive', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ modelProviderId: coreIdPipe }),
				response: Domain.ModelProvider.modelProviderPipe,
			},
		})(async (req) => unarchiveSelectedModelProvider(context, req.cookies, req.params.modelProviderId))
		.post('/model-providers/:modelProviderId/models', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ modelProviderId: coreIdPipe }),
				body: createModelRequestSchema,
				response: Domain.Model.modelPipe,
			},
		})(async (req) => createSelectedModel(context, req.cookies, req.params.modelProviderId, req.body))
		.put('/model-providers/:modelProviderId/models/:modelId', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ modelProviderId: coreIdPipe, modelId: coreIdPipe }),
				body: updateModelRequestSchema,
				response: Domain.Model.modelPipe,
			},
		})(async (req) => updateSelectedModel(context, req.cookies, req.params.modelProviderId, req.params.modelId, req.body))
		.post('/model-providers/:modelProviderId/models/:modelId/archive', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ modelProviderId: coreIdPipe, modelId: coreIdPipe }),
				response: Domain.Model.modelPipe,
			},
		})(async (req) => archiveSelectedModel(context, req.cookies, req.params.modelProviderId, req.params.modelId))
		.post('/model-providers/:modelProviderId/models/:modelId/unarchive', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ modelProviderId: coreIdPipe, modelId: coreIdPipe }),
				response: Domain.Model.modelPipe,
			},
		})(async (req) => unarchiveSelectedModel(context, req.cookies, req.params.modelProviderId, req.params.modelId))
		.post('/model-providers/:modelProviderId/models/:modelId/preflight', {
			schema: {
				cookies: portfolioRequestCookieSchema,
				params: v.object({ modelProviderId: coreIdPipe, modelId: coreIdPipe }),
				response: Domain.Evidence.validationEvidencePipe,
			},
		})(async (req) => preflightSelectedModel(context, req.cookies, req.params.modelProviderId, req.params.modelId))
}

function listSelectedModelProviders(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	query: PaginatedQuery,
): Promise<Queries.ListModelProviders.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const providers = await core.queries.listModelProviders(query)
		return providers.ok ? providers.value : throwCoreOperationError(providers.error)
	})
}

function getSelectedModelProvider(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	modelProviderId: string,
): Promise<Queries.GetModelProvider.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const provider = await core.queries.getModelProvider({ modelProviderId })
		return provider.ok ? provider.value : throwCoreOperationError(provider.error)
	})
}

function getSelectedModel(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	modelProviderId: string,
	modelId: string,
): Promise<Queries.GetModel.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		const model = await core.queries.getModel({ modelId })
		if (!model.ok) return throwCoreOperationError(model.error)
		if (model.value.provider.id !== modelProviderId) throwCoreOperationError({ type: 'not-found', resource: 'model' })
		return model.value
	})
}

function listSelectedModelReferences(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	modelProviderId: string,
	modelId: string,
): Promise<Queries.ListModelReferences.Result> {
	return withSelectedPortfolioCore(context, cookies, async ({ core }) => {
		await ensureModelBelongsToProvider(core, modelProviderId, modelId)
		const references = await core.queries.listModelReferences({ modelId })
		return references.ok ? references.value : throwCoreOperationError(references.error)
	})
}

function createSelectedModelProvider(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	input: CreateModelProviderRequest,
): Promise<Domain.ModelProvider.ModelProvider> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const provider = await core.commands.createModelProvider(input, commandContext(workspaceMember.id))
		return provider.ok ? provider.value : throwCoreOperationError(provider.error)
	})
}

function updateSelectedModelProvider(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	modelProviderId: string,
	input: UpdateModelProviderRequest,
): Promise<Domain.ModelProvider.ModelProvider> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const provider = await core.commands.updateModelProvider({ modelProviderId, ...input }, commandContext(workspaceMember.id))
		return provider.ok ? provider.value : throwCoreOperationError(provider.error)
	})
}

function archiveSelectedModelProvider(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	modelProviderId: string,
): Promise<Domain.ModelProvider.ModelProvider> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const provider = await core.commands.archiveModelProvider({ modelProviderId }, commandContext(workspaceMember.id))
		return provider.ok ? provider.value : throwCoreOperationError(provider.error)
	})
}

function unarchiveSelectedModelProvider(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	modelProviderId: string,
): Promise<Domain.ModelProvider.ModelProvider> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const provider = await core.commands.unarchiveModelProvider({ modelProviderId }, commandContext(workspaceMember.id))
		return provider.ok ? provider.value : throwCoreOperationError(provider.error)
	})
}

function createSelectedModel(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	modelProviderId: string,
	input: CreateModelRequest,
): Promise<Domain.Model.Model> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		const model = await core.commands.createModel({ providerId: modelProviderId, ...input }, commandContext(workspaceMember.id))
		return model.ok ? model.value : throwCoreOperationError(model.error)
	})
}

function updateSelectedModel(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	modelProviderId: string,
	modelId: string,
	input: UpdateModelRequest,
): Promise<Domain.Model.Model> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		await ensureModelBelongsToProvider(core, modelProviderId, modelId)
		const model = await core.commands.updateModel({ modelId, ...input }, commandContext(workspaceMember.id))
		return model.ok ? model.value : throwCoreOperationError(model.error)
	})
}

function archiveSelectedModel(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	modelProviderId: string,
	modelId: string,
): Promise<Domain.Model.Model> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		await ensureModelBelongsToProvider(core, modelProviderId, modelId)
		const model = await core.commands.archiveModel({ modelId }, commandContext(workspaceMember.id))
		return model.ok ? model.value : throwCoreOperationError(model.error)
	})
}

function unarchiveSelectedModel(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	modelProviderId: string,
	modelId: string,
): Promise<Domain.Model.Model> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		await ensureModelBelongsToProvider(core, modelProviderId, modelId)
		const model = await core.commands.unarchiveModel({ modelId }, commandContext(workspaceMember.id))
		return model.ok ? model.value : throwCoreOperationError(model.error)
	})
}

function preflightSelectedModel(
	context: ServerApiContext,
	cookies: PortfolioRequestCookies,
	modelProviderId: string,
	modelId: string,
): Promise<Domain.Evidence.ValidationEvidence> {
	return withSelectedPortfolioCore(context, cookies, async ({ core, workspaceMember }) => {
		await ensureModelBelongsToProvider(core, modelProviderId, modelId)
		const evidence = await core.commands.preflightModel({ modelId }, commandContext(workspaceMember.id))
		return evidence.ok ? evidence.value : throwCoreOperationError(evidence.error)
	})
}

async function ensureModelBelongsToProvider(
	core: SelectedPortfolioCoreContext['core'],
	modelProviderId: string,
	modelId: string,
): Promise<void> {
	const model = await core.queries.getModel({ modelId })
	if (!model.ok) return throwCoreOperationError(model.error)

	if (model.value.provider.id !== modelProviderId) throwCoreOperationError({ type: 'not-found', resource: 'model' })
}

function commandContext(workspaceMemberId: string) {
	return { actor: { type: 'workspace-member', id: workspaceMemberId }, correlationId: null }
}
