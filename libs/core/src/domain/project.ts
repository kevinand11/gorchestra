import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'
import { projectConfigRecordPipe, type ProjectConfig, type ProjectConfigRecord } from './config'
import { repositoryPipe } from './repository'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'

export const sourceControlProjectSourcePipe = v.object({ type: v.eq('source-control') })
export type SourceControlProjectSource = PipeOutput<typeof sourceControlProjectSourcePipe>

export const projectSourcePipe = v.discriminate((value) => value.type, {
	'source-control': sourceControlProjectSourcePipe,
})
export type ProjectSource = PipeOutput<typeof projectSourcePipe>

export const projectSchema = coreSchema('projects')
	.field('title', nonEmptyTrimmedStringPipe)
	.field('source', projectSourcePipe)
	.field('config', projectConfigRecordPipe)
	.field('created', auditStampPipe)
	.build()
export const projectPipe = schemaToPipe(projectSchema)
export type Project = PipeOutput<typeof projectPipe>

export const sourceControlProjectListSourcePipe = v.object({ type: v.eq('source-control'), repositories: v.array(repositoryPipe) })
export type SourceControlProjectListSource = PipeOutput<typeof sourceControlProjectListSourcePipe>

export const listedProjectPipe = v.object({
	id: idPipe,
	title: nonEmptyTrimmedStringPipe,
	source: v.discriminate((value) => value.type, { 'source-control': sourceControlProjectListSourcePipe }),
	config: projectConfigRecordPipe,
	created: auditStampPipe,
})
export type ListedProject = PipeOutput<typeof listedProjectPipe>

export type { ProjectConfig, ProjectConfigRecord }
