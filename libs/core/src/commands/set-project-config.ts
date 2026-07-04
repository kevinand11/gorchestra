import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { projectConfigPipe } from '../domain/config'
import type { Project } from '../domain/project'
import type { InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	agentRunProfileIdsFromProjectConfig,
	getRequired,
	normalizeProjectConfigRecord,
	updateRecordValue,
	validateSelectableAgentRunProfiles,
	withAuditStampTransaction,
} from './utils/storage'

const setProjectConfigInputPipe = v.object({ projectId: idPipe, config: projectConfigPipe })
export type Input = PipeOutput<typeof setProjectConfigInputPipe>

export type Result = Project
export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createSetProjectConfigCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('setProjectConfig', setProjectConfigInputPipe, (input, context) =>
		withAuditStampTransaction(
			runtime,
			context,
			async (storage, stamp): Promise<CoreResult<Project, Exclude<Error, InvalidInputError>>> => {
				const projectResult = await getRequired('project', storage, input.projectId)
				if (!projectResult.ok) return projectResult

				const profileValidation = await validateSelectableAgentRunProfiles(
					storage,
					agentRunProfileIdsFromProjectConfig(input.config),
				)
				if (!profileValidation.ok) return profileValidation

				return updateRecordValue('project', storage, projectResult.value.id, {
					config: normalizeProjectConfigRecord(input.config, stamp),
				})
			},
		),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const {
		context,
		createTestCoreRuntime,
		createTestCoreServices,
		defaultDeliveryWorkConfig,
		localStamp,
		seedAgentRunProfile,
		seedProject,
	} = await import('../utils/test-helpers')

	describe('setProjectConfig command', () => {
		it('sets Project config as a required retained config record', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			seedAgentRunProfile(options.tx, 'agent-run-profile-2', 'model-1')
			const command = createSetProjectConfigCommand(createTestCoreRuntime(options))

			const config = { work: defaultDeliveryWorkConfig('agent-run-profile-2') }
			const result = await command({ projectId: 'project-1', config }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'project-1',
					title: 'Project',
					source: { type: 'source-control' },
					config: { configured: localStamp(), value: config },
					created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				},
			})
			expect(options.tx.projects.records.get('project-1')?.config).toEqual({ configured: localStamp(), value: config })
		})
	})
}
