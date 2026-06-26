import { Domain } from '@gorchestra/core'
import { v, type PipeOutput } from 'valleyed'

import { selectionCookieName } from '../../../modules/selection-cookie'
import { optionalCookiePipe } from '../../http'
import { sessionCookieSchema } from '../../session'

const selectionCookieSchema = optionalCookiePipe(selectionCookieName)

export const portfolioRequestCookieSchema = v.merge(sessionCookieSchema, selectionCookieSchema)
export const createProjectRequestSchema = v.object({ title: Domain.Commons.nonEmptyTrimmedStringPipe })
export const createPlanRequestSchema = v.object({ title: Domain.Commons.nonEmptyTrimmedStringPipe })
const createMemoryLinkRequestSchema = v.discriminate((value) => value.type, {
	supersedes: v.object({ type: v.eq('supersedes'), toMemoryId: Domain.Commons.idPipe }),
})
export const createMemoryRequestSchema = v.object({
	title: Domain.Commons.nonEmptyTrimmedStringPipe,
	body: Domain.Memory.memoryBodyPipe,
	type: Domain.Memory.memoryTypePipe,
	links: v.array(createMemoryLinkRequestSchema),
})
export const createSecretRequestSchema = v.object({
	name: Domain.Commons.nonEmptyTrimmedStringPipe,
	value: v.string().pipe(v.custom<string>((value) => value.trim().length > 0, 'Secret value is required')),
})
export const createRepositoryRequestSchema = v.object({ config: Domain.Repository.repositoryConfigPipe })

export type PortfolioRequestCookies = Record<string, string | undefined>
export type CreateProjectRequest = PipeOutput<typeof createProjectRequestSchema>
export type CreatePlanRequest = PipeOutput<typeof createPlanRequestSchema>
export type CreateMemoryRequest = PipeOutput<typeof createMemoryRequestSchema>
export type CreateSecretRequest = PipeOutput<typeof createSecretRequestSchema>
export type CreateRepositoryRequest = PipeOutput<typeof createRepositoryRequestSchema>
export type RepositoryPreflightEvidence = Domain.Evidence.ValidationEvidence & { operation: { type: 'repository-preflight' } }
