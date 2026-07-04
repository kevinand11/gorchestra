import { v, type PipeOutput } from 'valleyed'

import { idPipe, type ArchivePeriod, type Id } from '../domain/commons'
import { modelReferencePipe, type ModelReference } from '../domain/model'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { getRequired, listRecords, withTransaction, type StorageBoundaryError } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({ modelId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = v.array(modelReferencePipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListModelReferencesQuery(options: CoreServices): Operation {
	return buildQueryHandler('listModelReferences', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const model = await getRequired('model', storage, input.modelId)
			if (!model.ok) return model

			const references = await listAgentRunProfileModelReferences(storage, model.value.id)
			return references.ok ? { ok: true, value: sortModelReferences(references.value) } : references
		}),
	)
}

async function listAgentRunProfileModelReferences(
	storage: CoreStorage,
	modelId: Id,
): Promise<CoreResult<ModelReference[], StorageBoundaryError>> {
	const profiles = await listRecords('agent-run-profile', storage)
	return profiles.ok
		? {
				ok: true,
				value: profiles.value.flatMap((profile) =>
					profile.modelUse.modelId === modelId
						? [
								{
									type: 'agent-run-profile' as const,
									active: !isArchived(profile.archivePeriods),
									agentRunProfileId: profile.id,
									agentRunProfileName: profile.name,
								},
							]
						: [],
				),
			}
		: profiles
}

function sortModelReferences(references: ModelReference[]): ModelReference[] {
	return [...references].sort(compareModelReferences)
}

function compareModelReferences(left: ModelReference, right: ModelReference): number {
	return firstNonZero([
		referenceActiveRank(left) - referenceActiveRank(right),
		left.agentRunProfileName.localeCompare(right.agentRunProfileName),
		left.agentRunProfileId.localeCompare(right.agentRunProfileId),
	])
}

function firstNonZero(values: number[]): number {
	return values.find((value) => value !== 0) ?? 0
}

function referenceActiveRank(reference: Pick<ModelReference, 'active'>): number {
	return reference.active ? 0 : 1
}

function isArchived(archivePeriods: ArchivePeriod[]): boolean {
	return archivePeriods.at(-1)?.unarchived === null
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedAgentRunProfile, seedSelectableModel } = await import('../utils/test-helpers')

	describe('listModelReferences query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.models.fail.get = true
			const query = createListModelReferencesQuery(options)

			const result = await query({ modelId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listModelReferences' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the target Model does not exist', async () => {
			const query = createListModelReferencesQuery(createTestCoreServices())

			const result = await query({ modelId: 'model-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'model', id: 'model-1' } })
		})

		it('returns an empty reference list for an unreferenced existing Model', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, 'model-1')
			const query = createListModelReferencesQuery(options)

			const result = await query({ modelId: 'model-1' })

			expect(result).toEqual({ ok: true, value: [] })
		})

		it('returns Agent Run Profile references ordered by active state and profile name', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, 'model-1')
			const archived = seedAgentRunProfile(options.tx, 'agent-run-profile-archived', 'model-1', { archived: true })
			archived.name = 'A Archived'
			const active = seedAgentRunProfile(options.tx, 'agent-run-profile-active', 'model-1')
			active.name = 'B Active'
			const query = createListModelReferencesQuery(options)

			const result = await query({ modelId: 'model-1' })

			expect(result).toEqual({
				ok: true,
				value: [
					{
						type: 'agent-run-profile',
						active: true,
						agentRunProfileId: 'agent-run-profile-active',
						agentRunProfileName: 'B Active',
					},
					{
						type: 'agent-run-profile',
						active: false,
						agentRunProfileId: 'agent-run-profile-archived',
						agentRunProfileName: 'A Archived',
					},
				],
			})
		})

		it('excludes Agent Run profile snapshots, current overrides, and override history events', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, 'model-1')
			options.tx.agentRuns.records.set('agent-run-1', {
				id: 'agent-run-1',
				agent: { type: 'model' },
				purpose: { type: 'planning', planId: 'plan-1' },
				profile: {
					agentRunProfileId: 'snapshot-profile',
					name: 'Snapshot',
					modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
				},
				modelUseOverride: {
					modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
					selected: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				},
				started: { at: '2026-06-01T00:00:00.000Z' },
				completed: null,
			})
			options.tx.agentRunEvents.records.set('agent-run-event-1', {
				id: 'agent-run-event-1',
				agentRunId: 'agent-run-1',
				cursor: '01J00000000000000000000001',
				occurred: { at: '2026-06-01T00:00:00.000Z' },
				body: {
					type: 'agent-run-model-use-override-changed',
					modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
					authorized: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				},
			})
			const query = createListModelReferencesQuery(options)

			const result = await query({ modelId: 'model-1' })

			expect(result).toEqual({ ok: true, value: [] })
		})

		it('returns storage errors when reference reads fail', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, 'model-1')
			options.tx.agentRunProfiles.fail.list = true
			const query = createListModelReferencesQuery(options)

			const result = await query({ modelId: 'model-1' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'agent-run-profile' } },
			})
		})
	})
}
