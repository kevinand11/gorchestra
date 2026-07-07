import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import { idPipe } from '../domain/commons'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { unarchiveStoredRecordWithAudit } from './utils/storage'

const unarchiveAgentRunProfileInputPipe = v.object({ agentRunProfileId: idPipe })
export type Input = PipeOutput<typeof unarchiveAgentRunProfileInputPipe>

export type Result = AgentRunProfile
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ResourceNotArchivedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createUnarchiveAgentRunProfileCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('unarchiveAgentRunProfile', unarchiveAgentRunProfileInputPipe, (input, context) =>
		unarchiveStoredRecordWithAudit(runtime, context, 'agent-run-profile', input.agentRunProfileId),
	)
}
