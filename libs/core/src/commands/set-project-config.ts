import { v, type PipeOutput } from 'valleyed'

import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './errors'
import {
	auditStamp,
	getRequired,
	modelIdsFromProjectConfigRecord,
	normalizeProjectConfigRecord,
	putRecord,
	validateSelectableModels,
	withTransaction,
} from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import { projectConfigPipe } from '../domain/config'
import { projectPipe, type Project } from '../domain/project'
import type { InvalidInputError } from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../types'

const setProjectConfigInputPipe = v.object({ projectId: idPipe, config: projectConfigPipe })
export type Input = PipeOutput<typeof setProjectConfigInputPipe>

export type Result = Project

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createSetProjectConfigCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('setProjectConfig', setProjectConfigInputPipe, (input, context) => {
		const stampResult = auditStamp(options, context)
		if (!stampResult.ok) return Promise.resolve(stampResult)

		return withTransaction(options, async (tx): Promise<CoreResult<Project, Exclude<Error, InvalidInputError>>> => {
			const projectResult = await getRequired('project', tx.projects, input.projectId, projectPipe)
			if (!projectResult.ok) return projectResult

			const config = normalizeProjectConfigRecord(input.config, stampResult.value)
			const referenceValidation = await validateSelectableModels(tx, modelIdsFromProjectConfigRecord(config))
			if (!referenceValidation.ok) return referenceValidation

			const project: Project = { ...projectResult.value, config }
			const putResult = await putRecord('project', tx.projects, project.id, project)
			if (!putResult.ok) return putResult

			return { ok: true, value: project }
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedProject, stamp } = await import('./test-utils')

	describe('setProjectConfig command', () => {
		it('sets Project config as a retained config record that can fold to null', async () => {
			const options = createTestOpenCoreOptions()
			seedProject(options.tx, 'project-1')
			const command = createSetProjectConfigCommand(options)

			const result = await command({ projectId: 'project-1', config: { model: null, work: null } }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'project-1',
					title: 'Project',
					source: { type: 'source-control' },
					config: { configured: localStamp(), value: null },
					created: stamp,
				},
			})
			expect(options.tx.projects.records.get('project-1')?.config).toEqual({ configured: localStamp(), value: null })
		})
	})
}
