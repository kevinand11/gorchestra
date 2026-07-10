import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import { agentRunRuntimeRequirementsPipe, agentRunSandboxConfigPipe } from '../domain/agent-run-runtime'
import { idPipe, nonEmptyTrimmedStringPipe } from '../domain/commons'
import { modelUseConfigPipe } from '../domain/config'
import type { DuplicateAgentRunRuntimeRequirementError, InvalidInputError, ResourceArchivedError } from '../errors'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from '../utils/command-errors'
import { buildCommandHandler } from '../utils/command-handler'
import { getRequired, updateRecordValue, validateAgentRunProfileConfig, withAuditStampTransaction } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const updateAgentRunProfileInputPipe = v.object({
	agentRunProfileId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	modelUse: modelUseConfigPipe,
	runtimeRequirements: agentRunRuntimeRequirementsPipe,
	sandboxConfig: agentRunSandboxConfigPipe,
})
export type Input = PipeOutput<typeof updateAgentRunProfileInputPipe>

export type Result = AgentRunProfile
export type Error =
	| InvalidInputError
	| ConfigCommandReferenceError
	| ConfigCommandStorageError
	| ResourceArchivedError
	| DuplicateAgentRunRuntimeRequirementError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createUpdateAgentRunProfileCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('updateAgentRunProfile', updateAgentRunProfileInputPipe, (input, context) =>
		withAuditStampTransaction(
			runtime,
			context,
			async (storage, stamp): Promise<CoreResult<AgentRunProfile, Exclude<Error, InvalidInputError>>> => {
				const existing = await getRequired('agent-run-profile', storage, input.agentRunProfileId)
				if (!existing.ok) return existing

				const configValidation = await validateAgentRunProfileConfig(storage, input)
				if (!configValidation.ok) return configValidation

				return updateRecordValue('agent-run-profile', storage, input.agentRunProfileId, {
					name: input.name,
					modelUse: input.modelUse,
					runtimeRequirements: input.runtimeRequirements,
					sandboxConfig: input.sandboxConfig,
					updated: stamp,
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
		defaultAgentRunSandboxConfig,
		localStamp,
		seedAgentRunProfile,
		seedSelectableModel,
	} = await import('../utils/test-helpers')

	describe('updateAgentRunProfile command', () => {
		it('updates Agent Run Profiles after validating selectable Model Use', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
			seedSelectableModel(options.tx, '01k00000000000000000000026')
			const command = createUpdateAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					agentRunProfileId: '01k00000000000000000000006',
					name: '  Execution  ',
					modelUse: { modelId: '01k00000000000000000000026', thinkingLevel: 'none' },
					runtimeRequirements: [],
					sandboxConfig: defaultAgentRunSandboxConfig(),
				},
				context,
			)

			expect(result).toMatchObject({
				ok: true,
				value: {
					name: 'Execution',
					modelUse: { modelId: '01k00000000000000000000026', thinkingLevel: 'none' },
					runtimeRequirements: [],
					sandboxConfig: defaultAgentRunSandboxConfig(),
					updated: localStamp(),
				},
			})
		})
	})
}
