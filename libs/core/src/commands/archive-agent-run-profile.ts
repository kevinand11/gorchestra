import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import { idPipe } from '../domain/commons'
import type {
	AlreadyArchivedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { archiveStoredRecordWithAudit } from './utils/storage'

const archiveAgentRunProfileInputPipe = v.object({ agentRunProfileId: idPipe })
export type Input = PipeOutput<typeof archiveAgentRunProfileInputPipe>

export type Result = AgentRunProfile
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| AlreadyArchivedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createArchiveAgentRunProfileCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('archiveAgentRunProfile', archiveAgentRunProfileInputPipe, (input, context) =>
		archiveStoredRecordWithAudit(runtime, context, 'agent-run-profile', input.agentRunProfileId),
	)
}
