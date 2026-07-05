import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import { agentRunRuntimeRequirementsPipe, firstDuplicateRuntimeRequirement } from '../domain/agent-run-runtime'
import { nonEmptyTrimmedStringPipe } from '../domain/commons'
import { modelUseConfigPipe } from '../domain/config'
import type { ArchivedSecretReferenceError, DuplicateAgentRunRuntimeRequirementError, InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	auditStamp,
	createRecordValue,
	loadSelectableModelFacts,
	modelIdsFromModelUses,
	nextId,
	validateModelUseConfigs,
	validateRuntimeRequirementSecretReferences,
	withTransaction,
} from './utils/storage'

const createAgentRunProfileInputPipe = v.object({
	name: nonEmptyTrimmedStringPipe,
	modelUse: modelUseConfigPipe,
	runtimeRequirements: agentRunRuntimeRequirementsPipe,
})
export type Input = PipeOutput<typeof createAgentRunProfileInputPipe>

export type Result = AgentRunProfile
export type Error =
	| InvalidInputError
	| ConfigCommandReferenceError
	| ConfigCommandStorageError
	| ArchivedSecretReferenceError
	| DuplicateAgentRunRuntimeRequirementError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createCreateAgentRunProfileCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createAgentRunProfile', createAgentRunProfileInputPipe, (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		const id = nextId(runtime.values, 'agent-run-profile')
		if (!id.ok) return Promise.resolve(id)

		return withTransaction(
			runtime.services,
			async (storage): Promise<CoreResult<AgentRunProfile, Exclude<Error, InvalidInputError>>> => {
				const duplicateRequirement = firstDuplicateRuntimeRequirement(input.runtimeRequirements)
				if (duplicateRequirement !== null) {
					return { ok: false, error: { type: 'duplicate-agent-run-runtime-requirement', requirement: duplicateRequirement } }
				}

				const facts = await loadSelectableModelFacts(storage, modelIdsFromModelUses([input.modelUse]))
				if (!facts.ok) return facts

				const modelUseValidation = validateModelUseConfigs(facts.value, [input.modelUse])
				if (!modelUseValidation.ok) return modelUseValidation

				const secretValidation = await validateRuntimeRequirementSecretReferences(storage, input.runtimeRequirements)
				if (!secretValidation.ok) return secretValidation

				const profile: AgentRunProfile = {
					id: id.value,
					name: input.name,
					modelUse: input.modelUse,
					runtimeRequirements: input.runtimeRequirements,
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
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSelectableModel } =
		await import('../utils/test-helpers')

	describe('createAgentRunProfile command', () => {
		it('creates Agent Run Profiles with selectable Model Use validation and explicit runtime requirements', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, 'model-1')
			const command = createCreateAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command(
				{ name: '  Planning  ', modelUse: { modelId: 'model-1', thinkingLevel: 'none' }, runtimeRequirements: [] },
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'agent-run-profile-1',
					name: 'Planning',
					modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
					runtimeRequirements: [],
					created: localStamp(),
					updated: null,
					archivePeriods: [],
				},
			})
		})
	})
}
