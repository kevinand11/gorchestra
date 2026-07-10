import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'

export const gitHubRepositoryConfigPipe = v.object({
	provider: v.eq('github'),
	owner: nonEmptyTrimmedStringPipe,
	name: nonEmptyTrimmedStringPipe,
	secretId: idPipe,
})
export type GitHubRepositoryConfig = PipeOutput<typeof gitHubRepositoryConfigPipe>

export const repositoryConfigPipe = v.discriminate((value) => value.provider, {
	github: gitHubRepositoryConfigPipe,
})
export type RepositoryConfig = PipeOutput<typeof repositoryConfigPipe>

export const repositorySchema = coreSchema('repositories')
	.field('projectId', idPipe)
	.field('config', repositoryConfigPipe)
	.field('created', auditStampPipe)
	.build()
export const repositoryPipe = schemaToPipe(repositorySchema)
export type Repository = PipeOutput<typeof repositoryPipe>
