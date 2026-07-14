import { inc, OrmValidationError } from 'equipped/orm'
import { PipeError, v } from 'valleyed'

import type { Id } from '../domain/commons'
import { dispatchCoordinationId, dispatchCoordinationSchema } from '../domain/dispatch-coordination'
import {
	dispatchRequestInputPipe,
	dispatchRequestSchema,
	maxDispatchReasons,
	type DispatchDeduplicationKey,
	type DispatchReason,
	type DispatchRequest,
	type DispatchRequestInput,
} from '../domain/dispatch-request'
import type { InvalidCoreServiceOutputError, InvariantViolationError, StorageOperationFailedError } from '../errors'
import type { CoreStorage } from '../services'
import { exclusiveAgentRunClaim } from './claims'
import { nextId, runtimeRecord, type CoreRuntimeValues } from '../utils/runtime-values'
import { withExplicitCoreStorageId } from '../utils/storage/schema'
import type { Result } from '../utils/types'

export interface DispatchAcceptance {
	requestId: Id
	disposition: 'created' | 'created-successor' | 'coalesced'
	wakeNeeded: boolean
}

export type DispatchAcceptanceError = InvalidCoreServiceOutputError | StorageOperationFailedError | InvariantViolationError

export interface DispatchAcceptanceContext {
	storage: CoreStorage
	values: CoreRuntimeValues
}

export async function acceptDispatchRequest(
	context: DispatchAcceptanceContext,
	input: DispatchRequestInput,
): Promise<Result<DispatchAcceptance, DispatchAcceptanceError>> {
	const parsed = v.validate(dispatchRequestInputPipe, input)
	if (!parsed.valid) return invariant('Core built invalid Dispatch Request input.')

	try {
		const coordination = await context.storage.on(dispatchCoordinationSchema).one().id(dispatchCoordinationId).find()
		if (coordination === null) return invariant('Dispatch Coordination singleton is missing.')
		await context.storage
			.on(dispatchCoordinationSchema)
			.one()
			.required()
			.id(dispatchCoordinationId)
			.update({ revision: inc<typeof dispatchCoordinationSchema>(dispatchCoordinationSchema.fields.revision, 1) })
	} catch (error) {
		return storageBoundaryFailure('dispatch-coordination', 'update', dispatchCoordinationId, error)
	}

	const matching = await matchingNonterminalRequests(context.storage, parsed.value.deduplicationKey)
	if (!matching.ok) return matching
	if (matching.value.length > 2) return invariant('Dispatch deduplication class has too many nonterminal requests.')

	const pendingOrWaiting = matching.value.find((request) => request.lifecycle.type === 'pending' || request.lifecycle.type === 'waiting')
	if (pendingOrWaiting !== undefined) {
		const coalesced = await coalesceReason(context.storage, pendingOrWaiting, parsed.value.reason)
		return coalesced.ok
			? {
					ok: true,
					value: { requestId: pendingOrWaiting.id, disposition: 'coalesced', wakeNeeded: true },
				}
			: coalesced
	}

	const leased = matching.value.find((request) => request.lifecycle.type === 'leased')
	return createAcceptedRequest(context, parsed.value, leased === undefined ? 'created' : 'created-successor')
}

async function matchingNonterminalRequests(
	storage: CoreStorage,
	deduplicationKey: DispatchDeduplicationKey | null,
): Promise<Result<DispatchRequest[], DispatchAcceptanceError>> {
	if (deduplicationKey === null) return { ok: true, value: [] }

	let records: DispatchRequest[]
	try {
		records = await storage
			.on(dispatchRequestSchema)
			.all()
			.where((filter) => filter.eq(dispatchRequestSchema.fields.deduplicationKey, deduplicationKey))
			.orderBy('id', 'asc')
			.find()
	} catch (error) {
		return storageBoundaryFailure('dispatch-request', 'list', null, error)
	}
	return {
		ok: true,
		value: records.filter(
			(request) =>
				request.lifecycle.type === 'pending' || request.lifecycle.type === 'waiting' || request.lifecycle.type === 'leased',
		),
	}
}

async function coalesceReason(
	storage: CoreStorage,
	request: DispatchRequest,
	reason: DispatchReason,
): Promise<Result<void, DispatchAcceptanceError>> {
	if (request.reasons.some((candidate) => reasonsEqual(candidate, reason))) return { ok: true, value: undefined }
	if (request.reasons.length >= maxDispatchReasons) return invariant('Dispatch Request reason capacity is exhausted.')

	try {
		const updated = await storage
			.on(dispatchRequestSchema)
			.one()
			.id(request.id)
			.update({ reasons: [...request.reasons, reason] })
		return updated === null ? invariant('Dispatch Request disappeared during acceptance.') : { ok: true, value: undefined }
	} catch (error) {
		return storageBoundaryFailure('dispatch-request', 'update', request.id, error)
	}
}

async function createAcceptedRequest(
	context: DispatchAcceptanceContext,
	input: DispatchRequestInput,
	disposition: 'created' | 'created-successor',
): Promise<Result<DispatchAcceptance, DispatchAcceptanceError>> {
	const requestId = nextId(context.values)
	if (!requestId.ok) return requestId
	const accepted = runtimeRecord(context.values)
	if (!accepted.ok) return accepted

	const request: DispatchRequest = {
		id: requestId.value,
		payload: input.payload,
		reasons: [input.reason],
		deduplicationKey: input.deduplicationKey,
		coordinationClaims: input.coordinationClaims,
		accepted: accepted.value,
		attemptCount: 0,
		expiredLeaseCount: 0,
		attempts: [],
		lifecycle: { type: 'pending', eligibleAt: accepted.value.at },
	}
	try {
		await withExplicitCoreStorageId(request.id, () =>
			context.storage.on(dispatchRequestSchema).one().create({
				payload: request.payload,
				reasons: request.reasons,
				deduplicationKey: request.deduplicationKey,
				coordinationClaims: request.coordinationClaims,
				accepted: request.accepted,
				attemptCount: request.attemptCount,
				expiredLeaseCount: request.expiredLeaseCount,
				attempts: request.attempts,
				lifecycle: request.lifecycle,
			}),
		)
		return { ok: true, value: { requestId: request.id, disposition, wakeNeeded: true } }
	} catch (error) {
		return storageBoundaryFailure('dispatch-request', 'create', request.id, error)
	}
}

interface DispatchRequestCapability {
	request(input: DispatchRequestInput): Promise<Result<DispatchAcceptance, DispatchAcceptanceError>>
}

export async function requestAgentRunPreparation(
	dispatch: DispatchRequestCapability,
	agentRunId: Id,
	reason: Extract<DispatchReason, { type: 'agent-run-created' | 'runtime-requirement-override-added' }>,
): Promise<Result<void, DispatchAcceptanceError>> {
	const accepted = await dispatch.request({
		payload: { type: 'agent-run-preparation', agentRunId },
		coordinationClaims: [exclusiveAgentRunClaim(agentRunId)],
		deduplicationKey: { type: 'agent-run-preparation', agentRunId },
		reason,
	})
	return accepted.ok ? { ok: true, value: undefined } : accepted
}

export async function requestAgentRunModelTurn(
	dispatch: DispatchRequestCapability,
	agentRunId: Id,
	inputEventId: Id,
): Promise<Result<void, DispatchAcceptanceError>> {
	const accepted = await dispatch.request({
		payload: { type: 'agent-run-model-turn', agentRunId },
		coordinationClaims: [exclusiveAgentRunClaim(agentRunId)],
		deduplicationKey: null,
		reason: { type: 'input-appended', inputEventId },
	})
	return accepted.ok ? { ok: true, value: undefined } : accepted
}

export async function requestAgentRunSandboxRelease(
	dispatch: DispatchRequestCapability,
	agentRunId: Id,
): Promise<Result<void, DispatchAcceptanceError>> {
	const accepted = await dispatch.request({
		payload: { type: 'agent-run-sandbox-release', agentRunId },
		coordinationClaims: [exclusiveAgentRunClaim(agentRunId)],
		deduplicationKey: { type: 'agent-run-sandbox-release', agentRunId },
		reason: { type: 'agent-run-completed' },
	})
	return accepted.ok ? { ok: true, value: undefined } : accepted
}

function reasonsEqual(left: DispatchReason, right: DispatchReason): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}

function storageBoundaryFailure<T>(
	resource: 'dispatch-request' | 'dispatch-coordination',
	operation: 'list' | 'create' | 'update',
	id: Id | null,
	error: unknown,
): Result<T, InvalidCoreServiceOutputError | StorageOperationFailedError> {
	if (error instanceof OrmValidationError) {
		return {
			ok: false,
			error: {
				type: 'invalid-core-service-output',
				service: 'storage',
				operation: `${operation}:${resource}`,
				pipeError: PipeError.root('Stored Core record failed schema validation.', null),
			},
		}
	}
	const storageOperation: StorageOperationFailedError['operation'] =
		operation === 'list'
			? { type: 'list', resource }
			: operation === 'create'
				? { type: 'create', resource, id: id ?? '' }
				: { type: 'update', resource, id: id ?? '' }
	return { ok: false, error: { type: 'storage-operation-failed', operation: storageOperation } }
}

function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}
