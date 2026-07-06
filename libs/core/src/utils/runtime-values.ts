import { Instance } from 'equipped'

import type { Result } from './types'
import type { CommandContext } from '../commands/types'
import { idPipe, isoDateTimePipe, type AuditStamp, type Id, type IsoDateTime, type RuntimeRecord } from '../domain/commons'
import type { InvalidCoreServiceOutputError } from '../errors'
import { validateCoreServiceOutput } from '../validation'

export interface CoreRuntimeValues {
	nextId(): string
	now(): Date
}

export function defaultCoreRuntimeValues(): CoreRuntimeValues {
	return {
		nextId: () => Instance.createId(),
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

export function nextId(values: CoreRuntimeValues): Result<Id, InvalidCoreServiceOutputError> {
	let output: unknown
	try {
		output = values.nextId()
	} catch {
		output = undefined
	}

	const validation = validateCoreServiceOutput(idPipe, output, 'runtime', 'nextId')
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
