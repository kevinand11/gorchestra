import type { StorageOperationFailedError } from '../errors'
import type { CoreTransaction, CoreTransactions } from './transactions'
import type { Result } from './types'

export async function runTwoPhase<TClaim, TOutside, TValue, TError>(
	transactions: CoreTransactions,
	phases: {
		read(transaction: CoreTransaction): Promise<Result<TClaim, TError>>
		run(claim: TClaim): Promise<Result<TOutside, TError>>
		write(transaction: CoreTransaction, claim: TClaim, outside: TOutside): Promise<Result<TValue, TError>>
	},
): Promise<Result<TValue, TError | StorageOperationFailedError>> {
	const claim = await transactions.run((transaction) => phases.read(transaction))
	if (!claim.ok) return claim

	const outside = await phases.run(claim.value)
	if (!outside.ok) return outside

	return transactions.run((transaction) => phases.write(transaction, claim.value, outside.value))
}

if (import.meta.vitest) {
	const { describe, expect, it, vi } = import.meta.vitest
	const { createTestCoreServices } = await import('./test-helpers')
	const { createRecord } = await import('./storage/helpers')

	describe('runTwoPhase', () => {
		it('commits the claim before outside work and opens a separate write transaction', async () => {
			const services = createTestCoreServices()
			const calls: string[] = []

			const result = await runTwoPhase(services.transactions, {
				read: async ({ storage }) => {
					const created = await createRecord('project', storage, projectRecord())
					if (!created.ok) return created
					calls.push('read')
					return { ok: true, value: created.value.id }
				},
				run: (projectId) => {
					calls.push(services.tx.projects.records.has(projectId) ? 'outside-after-commit' : 'outside-before-commit')
					return Promise.resolve({ ok: true, value: 'outside-value' })
				},
				write: (_transaction, projectId, outside) => {
					calls.push(`write:${projectId}:${outside}`)
					return Promise.resolve({ ok: true, value: outside })
				},
			})

			expect(result).toEqual({ ok: true, value: 'outside-value' })
			expect(calls).toEqual(['read', 'outside-after-commit', 'write:01k00000000000000000000030:outside-value'])
			expect(services.transactionCalls()).toBe(2)
		})

		it('skips the write phase when outside work returns an error', async () => {
			const services = createTestCoreServices()
			const write = vi.fn()

			const result = await runTwoPhase(services.transactions, {
				read: () => Promise.resolve({ ok: true, value: 'claim' }),
				run: () => Promise.resolve({ ok: false, error: { type: 'outside-failure' as const } }),
				write,
			})

			expect(result).toEqual({ ok: false, error: { type: 'outside-failure' } })
			expect(write).not.toHaveBeenCalled()
			expect(services.transactionCalls()).toBe(1)
		})

		it('rolls back write-phase records and effects when the write phase returns an error', async () => {
			const publish = vi.fn()
			const services = createTestCoreServices({ notifications: { publish } })

			const result = await runTwoPhase(services.transactions, {
				read: () => Promise.resolve({ ok: true, value: 'claim' }),
				run: () => Promise.resolve({ ok: true, value: 'outside' }),
				write: async ({ storage, notifications }) => {
					const created = await createRecord('project', storage, projectRecord())
					if (!created.ok) throw new Error('Expected the test Project write to succeed.')
					notifications.emit({
						type: 'assistant-message-draft-updated',
						agentRunId: '01k00000000000000000000002',
						turnStartedEventId: '01k00000000000000000000003',
						draftId: 'draft-1',
						delta: { type: 'model-output-started' },
					})
					return { ok: false, error: { type: 'write-failure' as const } }
				},
			})

			expect(result).toEqual({ ok: false, error: { type: 'write-failure' } })
			expect(services.tx.projects.records.size).toBe(0)
			expect(publish).not.toHaveBeenCalled()
			expect(services.transactionCalls()).toBe(2)
		})
	})

	function projectRecord() {
		const stamp = { origin: 'imported' as const, at: '2026-06-10T12:00:00.000Z' }
		return {
			id: '01k00000000000000000000030',
			title: 'Project',
			source: { type: 'source-control' as const },
			config: {
				configured: stamp,
				value: {
					work: {
						maxProcessableSliceSlots: 1,
						maxCorrectionRetriesPerFailure: 1,
						executionAgentRunProfileId: '01k00000000000000000000006',
						revisionExecutionAgentRunProfileId: null,
					},
				},
			},
			created: stamp,
		}
	}
}
