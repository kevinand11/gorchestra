import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { projectConfigPipe } from '../domain/config'
import type { Project } from '../domain/project'
import type { InvalidInputError } from '../errors'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from '../utils/command-errors'
import { buildCommandHandler } from '../utils/command-handler'
import {
	agentRunProfileIdsFromProjectConfig,
	auditStamp,
	getRequired,
	normalizeProjectConfigRecord,
	updateRecordValue,
	validateSelectableAgentRunProfiles,
} from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const setProjectConfigInputPipe = v.object({ projectId: idPipe, config: projectConfigPipe })
export type Input = PipeOutput<typeof setProjectConfigInputPipe>

export type Result = Project
export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createSetProjectConfigCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('setProjectConfig', setProjectConfigInputPipe, async (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return stamp

		return runtime.transactions.run(async ({ storage }): Promise<CoreResult<Project, Exclude<Error, InvalidInputError>>> => {
			const projectResult = await getRequired('project', storage, input.projectId)
			if (!projectResult.ok) return projectResult

			const profileValidation = await validateSelectableAgentRunProfiles(storage, agentRunProfileIdsFromProjectConfig(input.config))
			if (!profileValidation.ok) return profileValidation

			return updateRecordValue('project', storage, projectResult.value.id, {
				config: normalizeProjectConfigRecord(input.config, stamp.value),
			})
		})
	})
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
			seedProject(options.tx, '01k00000000000000000000030')
			seedAgentRunProfile(options.tx, '01k00000000000000000000007', '01k00000000000000000000024')
			const command = createSetProjectConfigCommand(createTestCoreRuntime(options))

			const config = { work: defaultDeliveryWorkConfig('01k00000000000000000000007') }
			const result = await command({ projectId: '01k00000000000000000000030', config }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000000030',
					title: 'Project',
					source: { type: 'source-control' },
					config: { configured: localStamp(), value: config },
					created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				},
			})
			expect(options.tx.projects.records.get('01k00000000000000000000030')?.config).toEqual({
				configured: localStamp(),
				value: config,
			})
		})
	})
}
