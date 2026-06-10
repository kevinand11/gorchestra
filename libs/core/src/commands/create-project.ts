import { v, type PipeOutput } from 'valleyed'

import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './errors'
import {
	auditStamp,
	modelIdsFromProjectConfigRecord,
	nextId,
	normalizeProjectConfigRecordForCreate,
	putRecord,
	validateSelectableModels,
	withTransaction,
} from './storage-utils'
import { buildCommandHandler } from './utils'
import { nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import { projectConfigPipe } from '../domain/config'
import { projectSourcePipe, type Project } from '../domain/project'
import type { InvalidInputError } from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../types'

const createProjectInputPipe = v.object({
	title: nonEmptyTrimmedStringPipe,
	source: projectSourcePipe,
	config: v.nullable(projectConfigPipe),
})
export type Input = PipeOutput<typeof createProjectInputPipe>

export type Result = Project

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCreateProjectCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('createProject', createProjectInputPipe, (input, context) => {
		const stampResult = auditStamp(options, context)
		if (!stampResult.ok) return Promise.resolve(stampResult)

		const idResult = nextId(options, 'project')
		if (!idResult.ok) return Promise.resolve(idResult)

		return withTransaction(options, async (tx): Promise<CoreResult<Project, Exclude<Error, InvalidInputError>>> => {
			const config = normalizeProjectConfigRecordForCreate(input.config, stampResult.value)
			if (config !== null) {
				const referenceValidation = await validateSelectableModels(tx, modelIdsFromProjectConfigRecord(config))
				if (!referenceValidation.ok) return referenceValidation
			}

			const project: Project = {
				id: idResult.value,
				title: input.title,
				source: input.source,
				config,
				created: stampResult.value,
			}
			const putResult = await putRecord('project', tx.projects, project.id, project)
			if (!putResult.ok) return putResult

			return { ok: true, value: project }
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp } = await import('./test-utils')

	describe('createProject command', () => {
		it('creates Projects with normalized titles, immutable source, folded create config, and Audit Stamps', async () => {
			const options = createTestOpenCoreOptions()
			const command = createCreateProjectCommand(options)

			const result = await command(
				{
					title: '  Build Gorchestra  ',
					source: { type: 'source-control' },
					config: {
						model: {
							planningModelId: null,
							revisionPlanningModelId: null,
							executionModelId: null,
							revisionExecutionModelId: null,
						},
						work: null,
					},
				},
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'project-1',
					title: 'Build Gorchestra',
					source: { type: 'source-control' },
					config: null,
					created: localStamp(),
				},
			})
			expect(options.tx.projects.records.get('project-1')).toEqual(result.ok ? result.value : null)
		})
	})
}
