import { v, type PipeOutput } from 'valleyed'

import { listedAgentRunProfilePipe } from '../domain/agent-run-profile'
import { idPipe } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import { buildQueryHandler } from '../utils/query-handler'
import { getRequired } from '../utils/storage/helpers'
import type { CoreTransactions } from '../utils/transactions'
import type { Result as CoreResult } from '../utils/types'

export const inputPipe = v.object({ agentRunProfileId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = listedAgentRunProfilePipe
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetAgentRunProfileQuery(transactions: CoreTransactions): Operation {
	return buildQueryHandler('getAgentRunProfile', inputPipe, (input) =>
		transactions.run(async ({ storage }) => {
			const profile = await getRequired('agent-run-profile', storage, input.agentRunProfileId)
			if (!profile.ok) return profile

			return {
				ok: true,
				value: {
					id: profile.value.id,
					name: profile.value.name,
					modelUse: profile.value.modelUse,
					runtimeRequirements: profile.value.runtimeRequirements,
					sandboxConfig: profile.value.sandboxConfig,
					created: profile.value.created,
					updated: profile.value.updated,
					archived: profile.value.archivePeriods.at(-1)?.unarchived === null,
				},
			}
		}),
	)
}
