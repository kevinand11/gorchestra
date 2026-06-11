import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import { projectConfigPipe } from '../domain/config'
import { projectPipe, type Project } from '../domain/project'
import type { InvalidInputError } from '../errors'
import type { CoreServices } from '../services'
import { buildCommandHandler } from '../utils/command'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from '../utils/command-errors'
import {
	getRequired,
	modelIdsFromProjectConfigRecord,
	normalizeProjectConfigRecord,
	putRecordValue,
	validateSelectableModels,
	withAuditStampTransaction,
} from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const setProjectConfigInputPipe = v.object({ projectId: idPipe, config: projectConfigPipe })
export type Input = PipeOutput<typeof setProjectConfigInputPipe>

export type Result = Project

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createSetProjectConfigCommand(options: CoreServices): Operation {
	return buildCommandHandler('setProjectConfig', setProjectConfigInputPipe, (input, context) =>
		withAuditStampTransaction(options, context, async (tx, stamp): Promise<CoreResult<Project, Exclude<Error, InvalidInputError>>> => {
			const projectResult = await getRequired('project', tx.projects, input.projectId, projectPipe)
			if (!projectResult.ok) return projectResult

			const config = normalizeProjectConfigRecord(input.config, stamp)
			const referenceValidation = await validateSelectableModels(tx, modelIdsFromProjectConfigRecord(config))
			if (!referenceValidation.ok) return referenceValidation

			const project: Project = { ...projectResult.value, config }
			return putRecordValue('project', tx.projects, project)
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedProject, stamp } = await import('../utils/test-helpers')

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
