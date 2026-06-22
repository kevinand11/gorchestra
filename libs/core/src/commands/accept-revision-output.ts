import { v, type PipeOutput } from 'valleyed'

import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { ReviewSurface, ReviewSurfaceScope } from '../domain/review-surface'
import type { Revision, RevisionGate, RevisionScope } from '../domain/revision'
import { revisionOutputProposalPipe } from '../domain/revision'
import type {
	DeliveryClosedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	RevisionGateClosedError,
	ReviewSurfaceAlreadyMergedError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { buildCommandHandler } from '../utils/command'
import {
	auditStamp,
	createRecordValue,
	getRequired,
	listRecords,
	nextId,
	updateRecordValue,
	withTransaction,
} from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const acceptRevisionOutputInputPipe = v.object({ revisionGateId: idPipe, output: revisionOutputProposalPipe })
export type Input = PipeOutput<typeof acceptRevisionOutputInputPipe>

export interface Result {
	revision: Revision
	revisionGate: RevisionGate
}

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| RevisionGateClosedError
	| DeliveryClosedError
	| ReviewSurfaceAlreadyMergedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createAcceptRevisionOutputCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('acceptRevisionOutput', acceptRevisionOutputInputPipe, (input, context) =>
		handleAcceptRevisionOutput(runtime, input, context),
	)
}

async function handleAcceptRevisionOutput(
	runtime: CoreRuntime,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const stamp = auditStamp(runtime.values, context)
	if (!stamp.ok) return stamp

	const revisionId = nextId(runtime.values, 'revision')
	if (!revisionId.ok) return revisionId

	return withTransaction(runtime.services, (storage) => acceptRevisionOutput(storage, input, stamp.value, revisionId.value))
}

async function acceptRevisionOutput(
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
	revisionId: Id,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const gate = await getRequired('revision-gate', storage, input.revisionGateId)
	if (!gate.ok) return gate

	return acceptForGate(storage, input, stamp, revisionId, gate.value)
}

async function acceptForGate(
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
	revisionId: Id,
	gate: RevisionGate,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	if (gate.closed !== null) return revisionGateClosed(gate.id)

	const existingRevision = await validateNoRevisionForGate(storage, gate.id)
	if (!existingRevision.ok) return existingRevision

	const scopeValidation = await validateGateScope(storage, gate)
	if (!scopeValidation.ok) return scopeValidation

	return writeAcceptedRevision(storage, input, stamp, revisionId, gate)
}

async function validateNoRevisionForGate(
	storage: CoreStorage,
	revisionGateId: Id,
): Promise<CoreResult<void, StorageOperationFailedError | InvalidCoreServiceOutputError | InvariantViolationError>> {
	const revisions = await listRecords('revision', storage, {
		where: (filter, fields) => filter.eq(fields.revisionGateId, revisionGateId),
	})
	if (!revisions.ok) return revisions

	return revisions.value.length > 0
		? invariant(`Revision Gate ${revisionGateId} already has a Revision.`)
		: { ok: true, value: undefined }
}

async function validateGateScope(storage: CoreStorage, gate: RevisionGate): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const reviewSurface = await getRequired('review-surface', storage, gate.reviewSurfaceId)
	if (!reviewSurface.ok) return reviewSurface

	const reviewSurfaceValidation = validateReviewSurfaceForGate(gate, reviewSurface.value)
	if (!reviewSurfaceValidation.ok) return reviewSurfaceValidation

	return validateRevisionScopeRecords(storage, gate.scope)
}

function validateReviewSurfaceForGate(
	gate: RevisionGate,
	reviewSurface: ReviewSurface,
): CoreResult<void, InvariantViolationError | ReviewSurfaceAlreadyMergedError> {
	const scopeValidation = validateReviewSurfaceScope(gate, reviewSurface)
	if (!scopeValidation.ok) return scopeValidation

	return validateReviewSurfaceNotMerged(reviewSurface)
}

function validateReviewSurfaceScope(gate: RevisionGate, reviewSurface: ReviewSurface): CoreResult<void, InvariantViolationError> {
	return revisionScopeKey(gate.scope) === reviewSurfaceScopeKey(reviewSurface.scope)
		? ok()
		: invariant(`Revision Gate ${gate.id} scope does not match Review Surface ${reviewSurface.id}.`)
}

function validateReviewSurfaceNotMerged(reviewSurface: ReviewSurface): CoreResult<void, ReviewSurfaceAlreadyMergedError> {
	return reviewSurface.closed?.type === 'merged' ? reviewSurfaceAlreadyMerged(reviewSurface.id) : ok()
}

function validateRevisionScopeRecords(
	storage: CoreStorage,
	scope: RevisionScope,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	return scope.type === 'delivery-artifact' ? validateDeliveryRevisionScope(storage, scope) : validateSliceRevisionScope(storage, scope)
}

async function validateDeliveryRevisionScope(
	storage: CoreStorage,
	scope: Extract<RevisionScope, { type: 'delivery-artifact' }>,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const delivery = await getRequired('delivery', storage, scope.deliveryId)
	if (!delivery.ok) return delivery

	return validateDeliveryRevisionArtifact(storage, scope, delivery.value)
}

async function validateDeliveryRevisionArtifact(
	storage: CoreStorage,
	scope: Extract<RevisionScope, { type: 'delivery-artifact' }>,
	delivery: Delivery,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const artifact = await getRequired('delivery-artifact', storage, scope.deliveryArtifactId)
	if (!artifact.ok) return artifact

	const ownership = validateDeliveryArtifactOwnership(artifact.value, delivery.id)
	if (!ownership.ok) return ownership

	return validateDeliveryOpen(delivery)
}

function validateDeliveryArtifactOwnership(
	artifact: { id: Id; deliveryId: Id },
	deliveryId: Id,
): CoreResult<void, InvariantViolationError> {
	return artifact.deliveryId === deliveryId ? ok() : invariant(`Delivery Artifact ${artifact.id} is outside Delivery ${deliveryId}.`)
}

async function validateSliceRevisionScope(
	storage: CoreStorage,
	scope: Extract<RevisionScope, { type: 'slice-artifact' }>,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const slice = await getRequired('slice', storage, scope.sliceId)
	if (!slice.ok) return slice

	return validateSliceRevisionArtifact(storage, scope, slice.value.id, slice.value.deliveryId)
}

async function validateSliceRevisionArtifact(
	storage: CoreStorage,
	scope: Extract<RevisionScope, { type: 'slice-artifact' }>,
	sliceId: Id,
	deliveryId: Id,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const artifact = await getRequired('slice-artifact', storage, scope.sliceArtifactId)
	if (!artifact.ok) return artifact

	const ownership = validateSliceArtifactOwnership(artifact.value, sliceId)
	if (!ownership.ok) return ownership

	return validateSliceParentDeliveryOpen(storage, deliveryId)
}

function validateSliceArtifactOwnership(artifact: { id: Id; sliceId: Id }, sliceId: Id): CoreResult<void, InvariantViolationError> {
	return artifact.sliceId === sliceId ? ok() : invariant(`Slice Artifact ${artifact.id} is outside Slice ${sliceId}.`)
}

async function validateSliceParentDeliveryOpen(
	storage: CoreStorage,
	deliveryId: Id,
): Promise<CoreResult<void, ResourceNotFoundError | StorageOperationFailedError | InvalidCoreServiceOutputError | DeliveryClosedError>> {
	const delivery = await getRequired('delivery', storage, deliveryId)
	if (!delivery.ok) return delivery

	return validateDeliveryOpen(delivery.value)
}

function validateDeliveryOpen(delivery: Delivery): CoreResult<void, DeliveryClosedError> {
	return delivery.closed === null
		? ok()
		: { ok: false, error: { type: 'delivery-closed', deliveryId: delivery.id, outcome: delivery.closed.type } }
}

async function writeAcceptedRevision(
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
	revisionId: Id,
	gate: RevisionGate,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const revision: Revision = {
		id: revisionId,
		revisionGateId: gate.id,
		scope: gate.scope,
		instruction: input.output.instruction,
		disposition: input.output.disposition,
		accepted: stamp,
	}
	const created = await createRecordValue('revision', storage, revision)
	if (!created.ok) return created

	const revisionGate = await updateRecordValue('revision-gate', storage, gate.id, {
		closed: { type: 'consumed-by-revision', consumed: stamp, revisionId: created.value.id },
	})
	return revisionGate.ok ? { ok: true, value: { revision: created.value, revisionGate: revisionGate.value } } : revisionGate
}

function revisionScopeKey(scope: RevisionScope): string {
	switch (scope.type) {
		case 'delivery-artifact':
			return `delivery:${scope.deliveryId}:${scope.deliveryArtifactId}`
		case 'slice-artifact':
			return `slice:${scope.sliceId}:${scope.sliceArtifactId}`
		default: {
			const exhaustive = scope satisfies never
			return exhaustive
		}
	}
}

function reviewSurfaceScopeKey(scope: ReviewSurfaceScope): string {
	switch (scope.type) {
		case 'delivery':
			return `delivery:${scope.deliveryId}:${scope.deliveryArtifactId}`
		case 'slice':
			return `slice:${scope.sliceId}:${scope.sliceArtifactId}`
		default: {
			const exhaustive = scope satisfies never
			return exhaustive
		}
	}
}

function ok(): CoreResult<void, never> {
	return { ok: true, value: undefined }
}

function revisionGateClosed(revisionGateId: Id): CoreResult<never, RevisionGateClosedError> {
	return { ok: false, error: { type: 'revision-gate-closed', revisionGateId } }
}

function reviewSurfaceAlreadyMerged(reviewSurfaceId: Id): CoreResult<never, ReviewSurfaceAlreadyMergedError> {
	return { ok: false, error: { type: 'review-surface-already-merged', reviewSurfaceId } }
}

function invariant(message: string): CoreResult<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedDelivery, seedSlice, stamp } =
		await import('../utils/test-helpers')

	describe('acceptRevisionOutput command', () => {
		it('validates input before reading storage', async () => {
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'acceptRevisionOutput' },
			})
		})

		it('creates a Delivery-scoped Revision and consumes the Revision Gate', async () => {
			const options = deliveryRevisionFixture()
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: 'revision-gate-1', output: revisionOutput() }, context)

			const expectedRevision = {
				id: 'revision-1',
				revisionGateId: 'revision-gate-1',
				scope: { type: 'delivery-artifact' as const, deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
				instruction: { body: 'Revise artifact.' },
				disposition: { body: 'Address requested changes.' },
				accepted: localStamp(),
			}
			const expectedGate = {
				...options.tx.revisionGates.records.get('revision-gate-1')!,
				closed: { type: 'consumed-by-revision' as const, consumed: localStamp(), revisionId: 'revision-1' },
			}
			expect(result).toEqual({ ok: true, value: { revision: expectedRevision, revisionGate: expectedGate } })
			expect(options.tx.revisions.records.get('revision-1')).toEqual(expectedRevision)
			expect(options.tx.revisionGates.records.get('revision-gate-1')).toEqual(expectedGate)
			expect(options.tx.actions.records.size).toBe(0)
		})

		it('creates a Slice-scoped Revision through the Slice parent Delivery', async () => {
			const options = sliceRevisionFixture()
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: 'revision-gate-1', output: revisionOutput() }, context)

			expect(result).toMatchObject({
				ok: true,
				value: {
					revision: {
						id: 'revision-1',
						revisionGateId: 'revision-gate-1',
						scope: { type: 'slice-artifact', sliceId: 'slice-1', sliceArtifactId: 'slice-artifact-1' },
					},
					revisionGate: { closed: { type: 'consumed-by-revision', consumed: localStamp(), revisionId: 'revision-1' } },
				},
			})
		})

		it('rejects non-open Revision Gates', async () => {
			const options = deliveryRevisionFixture()
			options.tx.revisionGates.records.get('revision-gate-1')!.closed = {
				type: 'closed-without-revision',
				closed: localStamp(),
			}
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: 'revision-gate-1', output: revisionOutput() }, context)

			expect(result).toEqual({ ok: false, error: { type: 'revision-gate-closed', revisionGateId: 'revision-gate-1' } })
		})

		it('rejects open Revision Gates that already have a Revision', async () => {
			const options = deliveryRevisionFixture()
			options.tx.revisions.records.set('revision-existing', {
				id: 'revision-existing',
				revisionGateId: 'revision-gate-1',
				scope: { type: 'delivery-artifact', deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
				instruction: { body: 'Existing.' },
				disposition: { body: 'Existing.' },
				accepted: stamp,
			})
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: 'revision-gate-1', output: revisionOutput() }, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Revision Gate revision-gate-1 already has a Revision.' },
			})
		})

		it('rejects Revision Gates whose Review Surface scope differs from the gate scope', async () => {
			const options = deliveryRevisionFixture()
			options.tx.reviewSurfaces.records.get('review-surface-1')!.scope = {
				type: 'delivery',
				deliveryId: 'delivery-1',
				deliveryArtifactId: 'other-artifact',
			}
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: 'revision-gate-1', output: revisionOutput() }, context)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'invariant-violation',
					message: 'Revision Gate revision-gate-1 scope does not match Review Surface review-surface-1.',
				},
			})
		})

		it('rejects Revision Gates whose Review Surface is merged', async () => {
			const options = deliveryRevisionFixture()
			options.tx.reviewSurfaces.records.get('review-surface-1')!.closed = {
				type: 'merged',
				merged: { at: '2026-06-10T12:00:00.000Z' },
				config: {
					type: 'source-control',
					repositoryId: 'repository-1',
					sourceBranch: 'delivery-branch',
					targetBranch: 'main',
				},
			}
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: 'revision-gate-1', output: revisionOutput() }, context)

			expect(result).toEqual({ ok: false, error: { type: 'review-surface-already-merged', reviewSurfaceId: 'review-surface-1' } })
		})

		it('rejects Revision Gates for closed Deliveries', async () => {
			const options = deliveryRevisionFixture()
			options.tx.deliveries.records.get('delivery-1')!.closed = {
				type: 'abandoned',
				abandoned: localStamp(),
				reason: 'No longer needed.',
			}
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ revisionGateId: 'revision-gate-1', output: revisionOutput() }, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'delivery-closed', deliveryId: 'delivery-1', outcome: 'abandoned' },
			})
		})
	})

	function revisionOutput() {
		return {
			instruction: { body: 'Revise artifact.' },
			disposition: { body: 'Address requested changes.' },
		}
	}

	function deliveryRevisionFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, 'delivery-1')
		seedDeliveryArtifact(options.tx)
		options.tx.reviewSurfaces.records.set('review-surface-1', deliveryReviewSurface())
		options.tx.revisionGates.records.set('revision-gate-1', {
			id: 'revision-gate-1',
			scope: { type: 'delivery-artifact', deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
			reviewSurfaceId: 'review-surface-1',
			opened: stamp,
			closed: null,
		})

		return options
	}

	function sliceRevisionFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, 'delivery-1')
		seedSlice(options.tx, 'slice-1', 'delivery-1')
		options.tx.sliceArtifacts.records.set('slice-artifact-1', {
			id: 'slice-artifact-1',
			sliceId: 'slice-1',
			config: { type: 'source-control', sliceBranch: 'slice-branch' },
			created: { at: '2026-06-10T12:00:00.000Z' },
		})
		options.tx.reviewSurfaces.records.set('review-surface-1', sliceReviewSurface())
		options.tx.revisionGates.records.set('revision-gate-1', {
			id: 'revision-gate-1',
			scope: { type: 'slice-artifact', sliceId: 'slice-1', sliceArtifactId: 'slice-artifact-1' },
			reviewSurfaceId: 'review-surface-1',
			opened: stamp,
			closed: null,
		})

		return options
	}

	function seedDeliveryArtifact(tx: ReturnType<typeof createTestCoreServices>['tx']) {
		tx.deliveryArtifacts.records.set('delivery-artifact-1', {
			id: 'delivery-artifact-1',
			deliveryId: 'delivery-1',
			config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
			created: { at: '2026-06-10T12:00:00.000Z' },
		})
	}

	function deliveryReviewSurface(): ReviewSurface {
		return {
			id: 'review-surface-1',
			scope: { type: 'delivery', deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
			config: {
				provider: 'github',
				pullRequestNumber: 1,
				repositoryId: 'repository-1',
				sourceBranch: 'delivery-branch',
				targetBranch: 'main',
			},
			title: 'Delivery',
			closed: null,
			created: { at: '2026-06-10T12:00:00.000Z' },
		}
	}

	function sliceReviewSurface(): ReviewSurface {
		return {
			id: 'review-surface-1',
			scope: { type: 'slice', sliceId: 'slice-1', sliceArtifactId: 'slice-artifact-1' },
			config: {
				provider: 'github',
				pullRequestNumber: 1,
				repositoryId: 'repository-1',
				sourceBranch: 'slice-branch',
				targetBranch: 'delivery-branch',
			},
			title: 'Slice',
			closed: null,
			created: { at: '2026-06-10T12:00:00.000Z' },
		}
	}
}
