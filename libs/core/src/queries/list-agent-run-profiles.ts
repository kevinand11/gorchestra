import { type PipeInput, type PipeOutput } from 'valleyed'

import { listedAgentRunProfilePipe } from '../domain/agent-run-profile'
import { mapPaginatedQueryEnvelope, paginatedQueryEnvelopePipe, paginatedQueryInputPipe } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvalidInputError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { buildQueryHandler } from '../utils/query-handler'
import { listRecordsPaginated, withTransaction } from '../utils/storage/helpers'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'

export const inputPipe = paginatedQueryInputPipe
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>

export const resultPipe = paginatedQueryEnvelopePipe(listedAgentRunProfilePipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListAgentRunProfilesQuery(options: CoreServices): Operation {
	return buildQueryHandler('listAgentRunProfiles', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const profiles = await listRecordsPaginated('agent-run-profile', storage, input)
			return profiles.ok
				? {
						ok: true,
						value: mapPaginatedQueryEnvelope(profiles.value, (profile) => ({
							id: profile.id,
							name: profile.name,
							modelUse: profile.modelUse,
							runtimeRequirements: profile.runtimeRequirements,
							sandboxConfig: profile.sandboxConfig,
							created: profile.created,
							updated: profile.updated,
							archived: profile.archivePeriods.at(-1)?.unarchived === null,
						})),
					}
				: profiles
		}),
	) as Operation
}
