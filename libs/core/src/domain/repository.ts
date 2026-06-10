import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'

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

export const repositoryPipe = v.object({
	id: idPipe,
	projectId: idPipe,
	config: repositoryConfigPipe,
	created: auditStampPipe,
})
export type Repository = PipeOutput<typeof repositoryPipe>
