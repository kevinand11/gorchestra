import { v, type PipeOutput } from 'valleyed'

import { listedAgentRunProfilePipe, type AgentRunProfile } from '../domain/agent-run-profile'
import type { ArchivePeriod } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvalidInputError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { listRecords, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({})
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = v.array(listedAgentRunProfilePipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListAgentRunProfilesQuery(options: CoreServices): Operation {
	return buildQueryHandler('listAgentRunProfiles', inputPipe, () =>
		withTransaction(options, async (storage) => {
			const profiles = await listRecords('agent-run-profile', storage, { orderBy: [{ field: 'name' }, { field: 'id' }] })
			return profiles.ok ? { ok: true, value: profiles.value.map(listedAgentRunProfile) } : profiles
		}),
	)
}

function listedAgentRunProfile(profile: AgentRunProfile): Result[number] {
	return {
		id: profile.id,
		name: profile.name,
		modelUse: profile.modelUse,
		created: profile.created,
		updated: profile.updated,
		archived: isArchived(profile.archivePeriods),
	}
}

function isArchived(archivePeriods: ArchivePeriod[]): boolean {
	return archivePeriods.at(-1)?.unarchived === null
}
