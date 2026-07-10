import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import { idPipe } from '../domain/commons'
import type {
	ResourceArchivedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import { buildCommandHandler } from '../utils/command-handler'
import { archiveStoredRecordWithAudit } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const archiveAgentRunProfileInputPipe = v.object({ agentRunProfileId: idPipe })
export type Input = PipeOutput<typeof archiveAgentRunProfileInputPipe>

export type Result = AgentRunProfile
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ResourceArchivedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createArchiveAgentRunProfileCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('archiveAgentRunProfile', archiveAgentRunProfileInputPipe, (input, context) =>
		archiveStoredRecordWithAudit(runtime, context, 'agent-run-profile', input.agentRunProfileId),
	)
}
