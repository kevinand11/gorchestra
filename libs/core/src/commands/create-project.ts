import { v, type PipeOutput } from 'valleyed'

import { nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import { projectConfigPipe } from '../domain/config'
import { projectSourcePipe, type Project } from '../domain/project'
import type { InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	auditStamp,
	createRecordValue,
	modelIdsFromProjectConfigRecord,
	nextId,
	normalizeProjectConfigRecordForCreate,
	validateSelectableModels,
	withTransaction,
} from './utils/storage'

const createProjectInputPipe = v.object({
	title: nonEmptyTrimmedStringPipe,
	source: projectSourcePipe,
	config: v.nullable(projectConfigPipe),
})
export type Input = PipeOutput<typeof createProjectInputPipe>

export type Result = Project

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCreateProjectCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createProject', createProjectInputPipe, (input, context) => {
		const stampResult = auditStamp(runtime.values, context)
		if (!stampResult.ok) return Promise.resolve(stampResult)

		const idResult = nextId(runtime.values, 'project')
		if (!idResult.ok) return Promise.resolve(idResult)

		return withTransaction(runtime.services, async (storage): Promise<CoreResult<Project, Exclude<Error, InvalidInputError>>> => {
			const config = normalizeProjectConfigRecordForCreate(input.config, stampResult.value)
			if (config !== null) {
				const referenceValidation = await validateSelectableModels(storage, modelIdsFromProjectConfigRecord(config))
				if (!referenceValidation.ok) return referenceValidation
			}

			const project: Project = {
				id: idResult.value,
				title: input.title,
				source: input.source,
				config,
				created: stampResult.value,
			}
			return createRecordValue('project', storage, project)
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp } = await import('../utils/test-helpers')

	describe('createProject command', () => {
		it('creates Projects with normalized titles, immutable source, folded create config, and Audit Stamps', async () => {
			const options = createTestCoreServices()
			const command = createCreateProjectCommand(createTestCoreRuntime(options))

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
