import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import { agentRunRuntimeRequirementsPipe, agentRunSandboxConfigPipe } from '../domain/agent-run-runtime'
import { nonEmptyTrimmedStringPipe } from '../domain/commons'
import { modelUseConfigPipe } from '../domain/config'
import type { DuplicateAgentRunRuntimeRequirementError, InvalidInputError, ResourceArchivedError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import { auditStamp, createRecordValue, nextId, validateAgentRunProfileConfig, withTransaction } from './utils/storage'

const createAgentRunProfileInputPipe = v.object({
	name: nonEmptyTrimmedStringPipe,
	modelUse: modelUseConfigPipe,
	runtimeRequirements: agentRunRuntimeRequirementsPipe,
	sandboxConfig: agentRunSandboxConfigPipe,
})
export type Input = PipeOutput<typeof createAgentRunProfileInputPipe>

export type Result = AgentRunProfile
export type Error =
	| InvalidInputError
	| ConfigCommandReferenceError
	| ConfigCommandStorageError
	| ResourceArchivedError
	| DuplicateAgentRunRuntimeRequirementError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createCreateAgentRunProfileCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createAgentRunProfile', createAgentRunProfileInputPipe, (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		const id = nextId(runtime.values)
		if (!id.ok) return Promise.resolve(id)

		return withTransaction(
			runtime.services,
			async (storage): Promise<CoreResult<AgentRunProfile, Exclude<Error, InvalidInputError>>> => {
				const configValidation = await validateAgentRunProfileConfig(storage, input)
				if (!configValidation.ok) return configValidation

				const profile: AgentRunProfile = {
					id: id.value,
					name: input.name,
					modelUse: input.modelUse,
					runtimeRequirements: input.runtimeRequirements,
					sandboxConfig: input.sandboxConfig,
					created: stamp.value,
					updated: null,
					archivePeriods: [],
				}
				return createRecordValue('agent-run-profile', storage, profile)
			},
		)
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, defaultAgentRunSandboxConfig, localStamp, seedSelectableModel } =
		await import('../utils/test-helpers')

	describe('createAgentRunProfile command', () => {
		it('creates Agent Run Profiles with selectable Model Use validation and explicit runtime requirements', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, '01k00000000000000000000024')
			const command = createCreateAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					name: '  Planning  ',
					modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
					runtimeRequirements: [],
					sandboxConfig: defaultAgentRunSandboxConfig(),
				},
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000010001',
					name: 'Planning',
					modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
					runtimeRequirements: [],
					sandboxConfig: defaultAgentRunSandboxConfig(),
					created: localStamp(),
					updated: null,
					archivePeriods: [],
				},
			})
		})

		it('validates Vercel sandbox credential Secret references', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, '01k00000000000000000000024')
			const command = createCreateAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					name: 'Planning',
					modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
					runtimeRequirements: [],
					sandboxConfig: {
						source: {
							type: 'vercel-runtime',
							runtime: 'node24',
							credentials: {
								tokenSecretId: '01k00000000000000000000040',
								teamIdSecretId: '01k00000000000000000000041',
								projectIdSecretId: '01k00000000000000000000042',
							},
						},
						resources: { vcpus: 2 },
						networkPolicy: { type: 'allow-all' },
					},
				},
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'secret', id: '01k00000000000000000000040' } })
		})
	})
}
