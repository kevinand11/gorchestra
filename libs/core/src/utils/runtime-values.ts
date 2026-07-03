import { Instance } from 'equipped'
import { monotonicFactory } from 'ulid'

import type { Result } from './types'
import type { CommandContext } from '../commands/types'
import { agentRunEventCursorPipe, type AgentRunEventCursor } from '../domain/agent-run'
import { idPipe, isoDateTimePipe, type AuditStamp, type Id, type IsoDateTime, type RuntimeRecord } from '../domain/commons'
import type { InvalidCoreServiceOutputError } from '../errors'
import { validateCoreServiceOutput } from '../validation'

export interface CoreRuntimeValues {
	nextId(scope?: string): string
	nextCursor(scope?: string): string
	now(): Date
}

export function defaultCoreRuntimeValues(): CoreRuntimeValues {
	const nextUlid = monotonicFactory()
	return {
		nextId: () => Instance.createId(),
		nextCursor: () => nextUlid(),
		now: () => new Date(),
	}
}

export function auditStamp(values: CoreRuntimeValues, context: CommandContext): Result<AuditStamp, InvalidCoreServiceOutputError> {
	const nowResult = nowIso(values)
	if (!nowResult.ok) return nowResult

	return {
		ok: true,
		value: {
			origin: 'local',
			at: nowResult.value,
			actor: context.actor,
			correlationId: context.correlationId,
		},
	}
}

export function runtimeRecord(values: CoreRuntimeValues): Result<RuntimeRecord, InvalidCoreServiceOutputError> {
	const nowResult = nowIso(values)
	if (!nowResult.ok) return nowResult

	return { ok: true, value: { at: nowResult.value } }
}

export function nextId(values: CoreRuntimeValues, scope?: string): Result<Id, InvalidCoreServiceOutputError> {
	let output: unknown
	try {
		output = values.nextId(scope)
	} catch {
		output = undefined
	}

	const validation = validateCoreServiceOutput(idPipe, output, 'runtime', 'nextId')
	return validation.ok ? { ok: true, value: validation.value } : validation
}

export function nextCursor(values: CoreRuntimeValues, scope?: string): Result<AgentRunEventCursor, InvalidCoreServiceOutputError> {
	let output: unknown
	try {
		output = values.nextCursor(scope)
	} catch {
		output = undefined
	}

	const validation = validateCoreServiceOutput(agentRunEventCursorPipe, output, 'runtime', 'nextCursor')
	return validation.ok ? { ok: true, value: validation.value } : validation
}

function nowIso(values: CoreRuntimeValues): Result<IsoDateTime, InvalidCoreServiceOutputError> {
	let output: unknown
	try {
		output = values.now().toISOString()
	} catch {
		output = undefined
	}

	const validation = validateCoreServiceOutput(isoDateTimePipe, output, 'runtime', 'now')
	return validation.ok ? { ok: true, value: validation.value } : validation
}
