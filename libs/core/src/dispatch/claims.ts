import type { Id } from '../domain/commons'
import type { DispatchCoordinationClaim, DispatchCoordinationScopeSegment } from '../domain/dispatch-request'

export interface DispatchClaimCandidate {
	id: Id
	coordinationClaims: DispatchCoordinationClaim[]
}

export function exclusiveAgentRunClaim(agentRunId: Id): DispatchCoordinationClaim {
	return { scope: [{ type: 'agent-run', id: agentRunId }], mode: { type: 'exclusive' } }
}

export function exclusiveDeliverySchedulerClaim(deliveryId: Id): DispatchCoordinationClaim {
	return {
		scope: [{ type: 'delivery', id: deliveryId }, { type: 'scheduler' }],
		mode: { type: 'exclusive' },
	}
}

export function exclusiveDeliveryClaim(deliveryId: Id): DispatchCoordinationClaim {
	return { scope: [{ type: 'delivery', id: deliveryId }], mode: { type: 'exclusive' } }
}

export function deliverySliceOperationClaims(deliveryId: Id, sliceId: Id, capacity: number): DispatchCoordinationClaim[] {
	return [
		{
			scope: [{ type: 'delivery', id: deliveryId }, { type: 'slice-pool' }],
			mode: { type: 'shared-capacity', capacity },
		},
		{
			scope: [
				{ type: 'delivery', id: deliveryId },
				{ type: 'slice', id: sliceId },
			],
			mode: { type: 'exclusive' },
		},
	]
}

export function admitDispatchCandidates<Candidate extends DispatchClaimCandidate>(
	candidates: readonly Candidate[],
	active: readonly DispatchClaimCandidate[],
	availableSlots: number,
): Candidate[] {
	if (availableSlots <= 0) return []

	const ordered = [...candidates].sort(compareCandidates)
	const reservations = ordered.filter((candidate) => hasBlockedBroaderExclusiveClaim(candidate, active))
	const admitted: Candidate[] = []
	for (const candidate of ordered) {
		if (admitted.length >= availableSlots) break
		if (conflictsWithReservation(candidate, reservations)) continue
		if (!canAcquireDispatchClaims(candidate.coordinationClaims, [...active, ...admitted])) continue
		admitted.push(candidate)
	}
	return admitted
}

export function canAcquireDispatchClaims(claims: readonly DispatchCoordinationClaim[], active: readonly DispatchClaimCandidate[]): boolean {
	for (const claim of claims) {
		for (const activeRequest of active) {
			for (const activeClaim of activeRequest.coordinationClaims) {
				if (claimsConflict(claim, activeClaim)) return false
			}
		}
		if (claim.mode.type !== 'shared-capacity') continue

		const occupied = active.reduce(
			(count, activeRequest) =>
				count +
				activeRequest.coordinationClaims.filter(
					(activeClaim) => activeClaim.mode.type === 'shared-capacity' && scopesEqual(claim.scope, activeClaim.scope),
				).length,
			0,
		)
		if (occupied >= claim.mode.capacity) return false
	}
	return true
}

export function claimsConflict(left: DispatchCoordinationClaim, right: DispatchCoordinationClaim): boolean {
	if (left.mode.type === 'shared-capacity' && right.mode.type === 'shared-capacity') return false
	return scopeIsPrefix(left.scope, right.scope) || scopeIsPrefix(right.scope, left.scope)
}

function compareCandidates(left: DispatchClaimCandidate, right: DispatchClaimCandidate): number {
	const breadth = broadestExclusiveScopeLength(left) - broadestExclusiveScopeLength(right)
	return breadth === 0 ? left.id.localeCompare(right.id) : breadth
}

function broadestExclusiveScopeLength(candidate: DispatchClaimCandidate): number {
	const lengths = candidate.coordinationClaims.filter((claim) => claim.mode.type === 'exclusive').map((claim) => claim.scope.length)
	return lengths.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...lengths)
}

function hasBlockedBroaderExclusiveClaim(candidate: DispatchClaimCandidate, active: readonly DispatchClaimCandidate[]): boolean {
	return candidate.coordinationClaims.some(
		(claim) =>
			claim.mode.type === 'exclusive' &&
			active.some((activeRequest) =>
				activeRequest.coordinationClaims.some(
					(activeClaim) => claim.scope.length < activeClaim.scope.length && scopeIsPrefix(claim.scope, activeClaim.scope),
				),
			),
	)
}

function conflictsWithReservation(candidate: DispatchClaimCandidate, reservations: readonly DispatchClaimCandidate[]): boolean {
	return reservations.some(
		(reservation) =>
			reservation.id !== candidate.id &&
			reservation.coordinationClaims.some(
				(reservedClaim) =>
					reservedClaim.mode.type === 'exclusive' &&
					candidate.coordinationClaims.some(
						(candidateClaim) =>
							reservedClaim.scope.length < candidateClaim.scope.length &&
							scopeIsPrefix(reservedClaim.scope, candidateClaim.scope),
					),
			),
	)
}

function scopeIsPrefix(prefix: readonly DispatchCoordinationScopeSegment[], scope: readonly DispatchCoordinationScopeSegment[]): boolean {
	if (prefix.length > scope.length) return false
	return prefix.every((segment, index) => segmentsEqual(segment, scope[index]))
}

function scopesEqual(left: readonly DispatchCoordinationScopeSegment[], right: readonly DispatchCoordinationScopeSegment[]): boolean {
	return left.length === right.length && scopeIsPrefix(left, right)
}

function segmentsEqual(left: DispatchCoordinationScopeSegment, right: DispatchCoordinationScopeSegment | undefined): boolean {
	if (right === undefined || left.type !== right.type) return false
	switch (left.type) {
		case 'agent-run':
		case 'delivery':
		case 'slice':
			return 'id' in right && left.id === right.id
		case 'scheduler':
		case 'slice-pool':
			return true
		default:
			throw new Error('Unhandled Dispatch Coordination Scope segment.')
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const id = (sequence: number) => `01k000000000000000000${sequence.toString().padStart(5, '0')}`
	const candidate = (sequence: number, coordinationClaims: DispatchCoordinationClaim[]): DispatchClaimCandidate => ({
		id: id(sequence),
		coordinationClaims,
	})

	describe('Dispatch Coordination Claims', () => {
		it('enforces parent overlap, shared capacity, and Slice exclusivity', () => {
			const deliveryId = id(10)
			const firstSlice = candidate(1, deliverySliceOperationClaims(deliveryId, id(20), 2))
			const secondSlice = candidate(2, deliverySliceOperationClaims(deliveryId, id(21), 2))
			const sameSlice = candidate(3, deliverySliceOperationClaims(deliveryId, id(20), 2))
			const delivery = candidate(4, [exclusiveDeliveryClaim(deliveryId)])

			expect(canAcquireDispatchClaims(secondSlice.coordinationClaims, [firstSlice])).toBe(true)
			expect(canAcquireDispatchClaims(sameSlice.coordinationClaims, [firstSlice])).toBe(false)
			expect(canAcquireDispatchClaims(delivery.coordinationClaims, [firstSlice])).toBe(false)
			expect(
				canAcquireDispatchClaims(candidate(5, deliverySliceOperationClaims(deliveryId, id(22), 2)).coordinationClaims, [
					firstSlice,
					secondSlice,
				]),
			).toBe(false)
		})

		it('uses candidate-snapshotted capacity after configuration changes', () => {
			const deliveryId = id(10)
			const active = candidate(1, deliverySliceOperationClaims(deliveryId, id(20), 1))

			expect(canAcquireDispatchClaims(deliverySliceOperationClaims(deliveryId, id(21), 2), [active])).toBe(true)
			expect(canAcquireDispatchClaims(deliverySliceOperationClaims(deliveryId, id(21), 1), [active])).toBe(false)
		})

		it('orders broader scopes before FIFO and does not let blocked unrelated work stall', () => {
			const deliveryId = id(10)
			const otherDeliveryId = id(11)
			const selected = admitDispatchCandidates(
				[
					candidate(3, deliverySliceOperationClaims(deliveryId, id(21), 2)),
					candidate(2, [exclusiveDeliveryClaim(deliveryId)]),
					candidate(1, [exclusiveDeliveryClaim(otherDeliveryId)]),
				],
				[candidate(9, deliverySliceOperationClaims(deliveryId, id(20), 2))],
				2,
			)

			expect(selected.map((request) => request.id)).toEqual([id(1)])
		})

		it('reserves a blocked broader parent until active descendants drain', () => {
			const deliveryId = id(10)
			const parent = candidate(1, [exclusiveDeliveryClaim(deliveryId)])
			const descendant = candidate(2, deliverySliceOperationClaims(deliveryId, id(21), 3))
			const active = candidate(9, deliverySliceOperationClaims(deliveryId, id(20), 3))

			expect(admitDispatchCandidates([parent, descendant], [active], 2)).toEqual([])
			expect(admitDispatchCandidates([parent, descendant], [], 2).map((request) => request.id)).toEqual([id(1)])
		})
	})
}
