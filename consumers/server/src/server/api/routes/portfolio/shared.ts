import { Domain } from '@gorchestra/core'
import { v, type PipeOutput } from 'valleyed'

import { selectionCookieName } from '../../../modules/selection-cookie'
import { optionalCookiePipe } from '../../http'
import { sessionCookieSchema } from '../../session'

const selectionCookieSchema = optionalCookiePipe(selectionCookieName)

export const portfolioRequestCookieSchema = v.merge(sessionCookieSchema, selectionCookieSchema)
export const createProjectRequestSchema = v.object({ title: Domain.Commons.nonEmptyTrimmedStringPipe })
const planModelConfigRequestSchema = v.object({ planning: v.nullable(Domain.Config.modelUseConfigPipe) })
const planConfigRequestSchema = v.object({ model: v.nullable(planModelConfigRequestSchema) })

export const createPlanRequestSchema = v.object({
	title: Domain.Commons.nonEmptyTrimmedStringPipe,
	initialMessage: Domain.Commons.nonEmptyTrimmedStringPipe,
	config: planConfigRequestSchema,
})
export const sendAgentRunMessageRequestSchema = v.object({ content: v.array(Domain.AgentRun.agentRunTextContentPipe) })
export const setPortfolioConfigRequestSchema = v.object({ config: Domain.Config.portfolioConfigPipe })
export const setProjectConfigRequestSchema = v.object({ config: Domain.Config.projectConfigPipe })
export const createModelProviderRequestSchema = v.object({
	name: Domain.Commons.nonEmptyTrimmedStringPipe,
	protocol: Domain.ModelProvider.modelProviderProtocolPipe,
	baseUrl: Domain.ModelProvider.modelProviderBaseUrlPipe,
	auth: v.nullable(Domain.ModelProvider.modelProviderAuthPipe),
	headers: Domain.ModelProvider.modelProviderHeadersPipe,
})
export const updateModelProviderRequestSchema = v.object({
	name: Domain.Commons.nonEmptyTrimmedStringPipe,
	baseUrl: Domain.ModelProvider.modelProviderBaseUrlPipe,
	auth: v.nullable(Domain.ModelProvider.modelProviderAuthPipe),
	headers: Domain.ModelProvider.modelProviderHeadersPipe,
})
export const createModelRequestSchema = v.object({
	name: Domain.Commons.nonEmptyTrimmedStringPipe,
	providerModelId: Domain.Commons.nonEmptyTrimmedStringPipe,
})
export const updateModelRequestSchema = v.object({
	name: Domain.Commons.nonEmptyTrimmedStringPipe,
	capabilities: Domain.Model.modelCapabilitiesPipe,
	pricing: v.nullable(Domain.Model.modelTokenPricingPipe),
})
export const createMemoryRequestSchema = v.object({
	parentId: v.nullable(Domain.Commons.idPipe),
	title: Domain.Memory.memoryTitlePipe,
	body: Domain.Memory.memoryBodyPipe,
})
export const createMemoryRevisionRequestSchema = v.object({
	expectedCurrentRevisionId: Domain.Commons.idPipe,
	title: Domain.Memory.memoryTitlePipe,
	body: Domain.Memory.memoryBodyPipe,
})
export const createSecretRequestSchema = v.object({
	name: Domain.Commons.nonEmptyTrimmedStringPipe,
	value: v.string().pipe(v.asTrimmed(), v.min<string>(1)),
})
export const createRepositoryRequestSchema = v.object({ config: Domain.Repository.repositoryConfigPipe })

export type PortfolioRequestCookies = Record<string, string | undefined>
export type CreateProjectRequest = PipeOutput<typeof createProjectRequestSchema>
export type CreatePlanRequest = PipeOutput<typeof createPlanRequestSchema>
export type SendAgentRunMessageRequest = PipeOutput<typeof sendAgentRunMessageRequestSchema>
export type SetPortfolioConfigRequest = PipeOutput<typeof setPortfolioConfigRequestSchema>
export type SetProjectConfigRequest = PipeOutput<typeof setProjectConfigRequestSchema>
export type CreateModelProviderRequest = PipeOutput<typeof createModelProviderRequestSchema>
export type UpdateModelProviderRequest = PipeOutput<typeof updateModelProviderRequestSchema>
export type CreateModelRequest = PipeOutput<typeof createModelRequestSchema>
export type UpdateModelRequest = PipeOutput<typeof updateModelRequestSchema>
export type CreateMemoryRequest = PipeOutput<typeof createMemoryRequestSchema>
export type CreateMemoryRevisionRequest = PipeOutput<typeof createMemoryRevisionRequestSchema>
export type CreateSecretRequest = PipeOutput<typeof createSecretRequestSchema>
export type CreateRepositoryRequest = PipeOutput<typeof createRepositoryRequestSchema>
export type RepositoryPreflightEvidence = Domain.Evidence.ValidationEvidence & { operation: { type: 'repository-preflight' } }
