import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'
import { projectConfigRecordPipe, type ProjectConfig, type ProjectConfigRecord } from './config'

export const sourceControlProjectSourcePipe = v.object({ type: v.eq('source-control') })
export type SourceControlProjectSource = PipeOutput<typeof sourceControlProjectSourcePipe>

export const projectSourcePipe = v.discriminate((value) => value.type, {
	'source-control': sourceControlProjectSourcePipe,
})
export type ProjectSource = PipeOutput<typeof projectSourcePipe>

export const projectPipe = v.object({
	id: idPipe,
	title: nonEmptyTrimmedStringPipe,
	source: projectSourcePipe,
	config: v.nullable(projectConfigRecordPipe),
	created: auditStampPipe,
})
export type Project = PipeOutput<typeof projectPipe>

export type { ProjectConfig, ProjectConfigRecord }
