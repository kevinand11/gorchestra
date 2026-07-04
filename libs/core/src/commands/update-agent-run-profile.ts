import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import { idPipe, nonEmptyTrimmedStringPipe } from '../domain/commons'
import { modelUseConfigPipe } from '../domain/config'
import type { InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	getRequired,
	loadSelectableModelFacts,
	modelIdsFromModelUses,
	updateRecordValue,
	validateModelUseConfigs,
	withAuditStampTransaction,
} from './utils/storage'

const updateAgentRunProfileInputPipe = v.object({
	agentRunProfileId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	modelUse: modelUseConfigPipe,
})
export type Input = PipeOutput<typeof updateAgentRunProfileInputPipe>

export type Result = AgentRunProfile
export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createUpdateAgentRunProfileCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('updateAgentRunProfile', updateAgentRunProfileInputPipe, (input, context) =>
		withAuditStampTransaction(
			runtime,
			context,
			async (storage, stamp): Promise<CoreResult<AgentRunProfile, Exclude<Error, InvalidInputError>>> => {
				const existing = await getRequired('agent-run-profile', storage, input.agentRunProfileId)
				if (!existing.ok) return existing

				const facts = await loadSelectableModelFacts(storage, modelIdsFromModelUses([input.modelUse]))
				if (!facts.ok) return facts

				const modelUseValidation = validateModelUseConfigs(facts.value, [input.modelUse])
				if (!modelUseValidation.ok) return modelUseValidation

				return updateRecordValue('agent-run-profile', storage, input.agentRunProfileId, {
					name: input.name,
					modelUse: input.modelUse,
					updated: stamp,
				})
			},
		),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedAgentRunProfile, seedSelectableModel } =
		await import('../utils/test-helpers')

	describe('updateAgentRunProfile command', () => {
		it('updates Agent Run Profiles after validating selectable Model Use', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')
			seedSelectableModel(options.tx, 'model-2')
			const command = createUpdateAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					agentRunProfileId: 'agent-run-profile-1',
					name: '  Execution  ',
					modelUse: { modelId: 'model-2', thinkingLevel: 'none' },
				},
				context,
			)

			expect(result).toMatchObject({
				ok: true,
				value: { name: 'Execution', modelUse: { modelId: 'model-2', thinkingLevel: 'none' }, updated: localStamp() },
			})
		})
	})
}
