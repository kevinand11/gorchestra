import { v, type PipeOutput } from 'valleyed'

import { listedAgentRunProfilePipe, type AgentRunProfile } from '../domain/agent-run-profile'
import { idPipe, type ArchivePeriod } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { getRequired, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({ agentRunProfileId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = listedAgentRunProfilePipe
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetAgentRunProfileQuery(options: CoreServices): Operation {
	return buildQueryHandler('getAgentRunProfile', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const profile = await getRequired('agent-run-profile', storage, input.agentRunProfileId)
			return profile.ok ? { ok: true, value: listedAgentRunProfile(profile.value) } : profile
		}),
	)
}

function listedAgentRunProfile(profile: AgentRunProfile): Result {
	return {
		id: profile.id,
		name: profile.name,
		modelUse: profile.modelUse,
		runtimeRequirements: profile.runtimeRequirements,
		created: profile.created,
		updated: profile.updated,
		archived: isArchived(profile.archivePeriods),
	}
}

function isArchived(archivePeriods: ArchivePeriod[]): boolean {
	return archivePeriods.at(-1)?.unarchived === null
}
