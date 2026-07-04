import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { nonEmptyTrimmedStringPipe } from '../domain/commons'
import { projectConfigPipe } from '../domain/config'
import { projectSourcePipe, type Project } from '../domain/project'
import type { InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	agentRunProfileIdsFromProjectConfig,
	auditStamp,
	createRecordValue,
	nextId,
	normalizeProjectConfigRecord,
	validateSelectableAgentRunProfiles,
	withTransaction,
} from './utils/storage'

const createProjectInputPipe = v.object({
	title: nonEmptyTrimmedStringPipe,
	source: projectSourcePipe,
	config: projectConfigPipe,
})
export type Input = PipeOutput<typeof createProjectInputPipe>

export type Result = Project
export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createCreateProjectCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createProject', createProjectInputPipe, (input, context) => {
		const stampResult = auditStamp(runtime.values, context)
		if (!stampResult.ok) return Promise.resolve(stampResult)

		const idResult = nextId(runtime.values, 'project')
		if (!idResult.ok) return Promise.resolve(idResult)

		return withTransaction(runtime.services, async (storage): Promise<CoreResult<Project, Exclude<Error, InvalidInputError>>> => {
			const profileValidation = await validateSelectableAgentRunProfiles(storage, agentRunProfileIdsFromProjectConfig(input.config))
			if (!profileValidation.ok) return profileValidation

			const project: Project = {
				id: idResult.value,
				title: input.title,
				source: input.source,
				config: normalizeProjectConfigRecord(input.config, stampResult.value),
				created: stampResult.value,
			}
			return createRecordValue('project', storage, project)
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, defaultDeliveryWorkConfig, localStamp, seedAgentRunProfile } =
		await import('../utils/test-helpers')

	describe('createProject command', () => {
		it('creates Projects with normalized titles, immutable source, required config, and Audit Stamps', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')
			const command = createCreateProjectCommand(createTestCoreRuntime(options))

			const result = await command(
				{ title: '  Build Gorchestra  ', source: { type: 'source-control' }, config: { work: defaultDeliveryWorkConfig() } },
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'project-1',
					title: 'Build Gorchestra',
					source: { type: 'source-control' },
					config: { configured: localStamp(), value: { work: defaultDeliveryWorkConfig() } },
					created: localStamp(),
				},
			})
			expect(options.tx.projects.records.get('project-1')).toEqual(result.ok ? result.value : null)
		})

		it('rejects missing Agent Run Profile references', async () => {
			const command = createCreateProjectCommand(createTestCoreRuntime(createTestCoreServices()))

			const result = await command(
				{ title: 'Project', source: { type: 'source-control' }, config: { work: defaultDeliveryWorkConfig('missing-profile') } },
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'agent-run-profile', id: 'missing-profile' } })
		})
	})
}
