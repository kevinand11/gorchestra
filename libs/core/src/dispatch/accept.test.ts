import { describe, expect, it } from 'vitest'

import { acceptDispatchRequest } from './accept'
import { exclusiveAgentRunClaim } from './claims'
import type { Id } from '../domain/commons'
import { maxDispatchReasons, type DispatchReason, type DispatchRequestInput } from '../domain/dispatch-request'
import { createTestCoreServices, testId } from '../utils/test-helpers'

function setupAcceptance() {
	const options = createTestCoreServices()
	const context = { storage: options.storage, values: options.values }
	const agentRunId = testId(2)
	const acceptPreparation = (reason: DispatchReason) =>
		options.storage.session(() => acceptDispatchRequest(context, preparationInput(agentRunId, reason)))
	return { options, agentRunId, acceptPreparation }
}

function preparationInput(agentRunId: Id, reason: DispatchReason): DispatchRequestInput {
	return {
		payload: { type: 'agent-run-preparation', agentRunId },
		reason,
		coordinationClaims: [exclusiveAgentRunClaim(agentRunId)],
		deduplicationKey: { type: 'agent-run-preparation', agentRunId },
	}
}

async function createPreparationAndLease(setup: ReturnType<typeof setupAcceptance>) {
	const first = await setup.acceptPreparation({ type: 'agent-run-created' })
	if (!first.ok) throw new Error('Expected first request.')
	const leased = setup.options.tx.dispatchRequests.records.get(first.value.requestId)
	if (leased === undefined) throw new Error('Expected stored request.')
	setup.options.tx.dispatchRequests.records.set(leased.id, {
		...leased,
		attemptCount: 1,
		lifecycle: {
			type: 'leased',
			attempt: {
				number: 1,
				token: 'token',
				coordinationEpoch: 0,
				claimed: leased.accepted,
				heartbeat: leased.accepted,
				expiresAt: leased.accepted.at,
			},
		},
	})
	return first.value.requestId
}

describe('acceptDispatchRequest', () => {
	it('coalesces pending semantic work and preserves distinct reason order', async () => {
		const setup = setupAcceptance()
		const first = await setup.acceptPreparation({ type: 'agent-run-created' })
		const secondReason = { type: 'runtime-requirement-override-added' as const, eventId: testId(3) }
		const second = await setup.acceptPreparation(secondReason)
		const duplicate = await setup.acceptPreparation({ type: 'agent-run-created' })

		expect(first).toMatchObject({ ok: true, value: { disposition: 'created' } })
		expect(second).toEqual({
			ok: true,
			value: { requestId: first.ok ? first.value.requestId : '', disposition: 'coalesced', wakeNeeded: true },
		})
		expect(duplicate).toEqual(second)
		expect([...setup.options.tx.dispatchRequests.records.values()][0]?.reasons).toEqual([{ type: 'agent-run-created' }, secondReason])
	})

	it('creates at most one pending successor behind leased semantic work', async () => {
		const setup = setupAcceptance()
		await createPreparationAndLease(setup)

		const successor = await setup.acceptPreparation({
			type: 'runtime-requirement-override-added',
			eventId: testId(3),
		})
		const coalesced = await setup.acceptPreparation({ type: 'agent-run-created' })

		expect(successor).toMatchObject({ ok: true, value: { disposition: 'created-successor' } })
		expect(coalesced).toMatchObject({
			ok: true,
			value: { requestId: successor.ok ? successor.value.requestId : '', disposition: 'coalesced' },
		})
		expect(setup.options.tx.dispatchRequests.records).toHaveLength(2)
	})

	it('does not coalesce request kinds with null semantic keys', async () => {
		const { options } = setupAcceptance()
		const input: DispatchRequestInput = {
			payload: { type: 'agent-run-model-turn', agentRunId: testId(2) },
			reason: { type: 'input-appended', inputEventId: testId(3) },
			coordinationClaims: [exclusiveAgentRunClaim(testId(2))],
			deduplicationKey: null,
		}

		const first = await options.storage.session(() =>
			acceptDispatchRequest({ storage: options.storage, values: options.values }, input),
		)
		const second = await options.storage.session(() =>
			acceptDispatchRequest({ storage: options.storage, values: options.values }, input),
		)

		expect(first).toMatchObject({ ok: true, value: { disposition: 'created' } })
		expect(second).toMatchObject({ ok: true, value: { disposition: 'created' } })
		expect(options.tx.dispatchRequests.records).toHaveLength(2)
	})

	it('fails safely rather than truncating bounded provenance', async () => {
		const setup = setupAcceptance()
		const requestId = await createPreparationAndLease(setup)
		const request = setup.options.tx.dispatchRequests.records.get(requestId)
		if (request === undefined) throw new Error('Expected stored request.')
		setup.options.tx.dispatchRequests.records.set(request.id, {
			...request,
			lifecycle: { type: 'pending', eligibleAt: request.accepted.at },
			reasons: Array.from({ length: maxDispatchReasons }, (_, index) => ({
				type: 'runtime-requirement-override-added' as const,
				eventId: testId(100 + index),
			})),
		})

		const result = await setup.acceptPreparation({ type: 'agent-run-created' })

		expect(result).toEqual({
			ok: false,
			error: { type: 'invariant-violation', message: 'Dispatch Request reason capacity is exhausted.' },
		})
	})
})
