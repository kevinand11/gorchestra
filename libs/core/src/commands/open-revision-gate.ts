import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRun } from '../domain/agent-run'
import { idPipe, type AuditStamp, type Id, type RuntimeRecord } from '../domain/commons'
import type { FetchedFeedback, ReviewSurface, ReviewSurfaceScope } from '../domain/review-surface'
import type { RevisionGate, RevisionScope } from '../domain/revision'
import type { InvalidInputError, ReviewSurfaceAlreadyMergedError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { createModelAgentRunWithProfileSnapshot } from '../utils/agent-run-events'
import type { CoreRuntimeValues } from '../utils/runtime-values'
import type { Result as CoreResult } from '../utils/types'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	agentRunProfileSnapshot,
	auditStamp,
	createRecordValue,
	getRequired,
	loadSelectableAgentRunProfile,
	nextId,
	runtimeRecord,
	withTransaction,
} from './utils/storage'

const openRevisionGateInputPipe = v.object({ reviewSurfaceId: idPipe, agentRunProfileId: idPipe })
export type Input = PipeOutput<typeof openRevisionGateInputPipe>

export interface Result {
	revisionGate: RevisionGate
	agentRun: AgentRun

	/** Fetched from current Review Surface; not stored as authoritative Portfolio data. */
	feedback: FetchedFeedback[]
}

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError | ReviewSurfaceAlreadyMergedError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createOpenRevisionGateCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('openRevisionGate', openRevisionGateInputPipe, (input, context) =>
		handleOpenRevisionGate(runtime, input, context),
	)
}

type OpenRevisionGateRuntimeValues = {
	stamp: AuditStamp
	revisionGateId: Id
	agentRunId: Id
	started: RuntimeRecord
	runtimeValues: CoreRuntimeValues
}

type OpenRevisionGateFacts = {
	revisionGate: RevisionGate
	agentRunId: Id
	started: RuntimeRecord
	profile: ReturnType<typeof agentRunProfileSnapshot>
}

async function handleOpenRevisionGate(runtime: CoreRuntime, input: Input, context: CommandContext): Promise<CoreResult<Result, Error>> {
	const values = openRevisionGateRuntimeValues(runtime, context)
	return values.ok ? withTransaction(runtime.services, (storage) => openRevisionGate(storage, input, values.value)) : values
}

function openRevisionGateRuntimeValues(
	runtime: CoreRuntime,
	context: CommandContext,
): CoreResult<OpenRevisionGateRuntimeValues, ConfigCommandStorageError> {
	const stamp = auditStamp(runtime.values, context)
	if (!stamp.ok) return stamp

	const revisionGateId = nextId(runtime.values, 'revision-gate')
	if (!revisionGateId.ok) return revisionGateId

	const agentRunId = nextId(runtime.values, 'agent-run')
	if (!agentRunId.ok) return agentRunId

	const started = runtimeRecord(runtime.values)
	return started.ok
		? {
				ok: true,
				value: {
					stamp: stamp.value,
					revisionGateId: revisionGateId.value,
					agentRunId: agentRunId.value,
					started: started.value,
					runtimeValues: runtime.values,
				},
			}
		: started
}

async function openRevisionGate(
	storage: CoreStorage,
	input: Input,
	values: OpenRevisionGateRuntimeValues,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const facts = await openRevisionGateFacts(storage, input, values)
	return facts.ok ? writeOpenRevisionGateFacts(storage, facts.value) : facts
}

async function openRevisionGateFacts(
	storage: CoreStorage,
	input: Input,
	values: OpenRevisionGateRuntimeValues,
): Promise<CoreResult<OpenRevisionGateFacts, Exclude<Error, InvalidInputError>>> {
	const reviewSurface = await getRequired('review-surface', storage, input.reviewSurfaceId)
	if (!reviewSurface.ok) return reviewSurface

	const notMerged = validateReviewSurfaceNotMerged(reviewSurface.value)
	if (!notMerged.ok) return notMerged

	const profile = await loadSelectableAgentRunProfile(storage, input.agentRunProfileId)
	return profile.ok
		? { ok: true, value: openRevisionGateFactsValue(values, reviewSurface.value, agentRunProfileSnapshot(profile.value)) }
		: profile
}

function openRevisionGateFactsValue(
	values: OpenRevisionGateRuntimeValues,
	reviewSurface: ReviewSurface,
	profile: ReturnType<typeof agentRunProfileSnapshot>,
): OpenRevisionGateFacts {
	return {
		revisionGate: {
			id: values.revisionGateId,
			scope: revisionScopeFromReviewSurfaceScope(reviewSurface.scope),
			reviewSurfaceId: reviewSurface.id,
			opened: values.stamp,
			closed: null,
		},
		agentRunId: values.agentRunId,
		started: values.started,
		profile,
	}
}

async function writeOpenRevisionGateFacts(
	storage: CoreStorage,
	facts: OpenRevisionGateFacts,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const revisionGate = await createRecordValue('revision-gate', storage, facts.revisionGate)
	if (!revisionGate.ok) return revisionGate

	const agentRun = await createModelAgentRunWithProfileSnapshot(storage, {
		agentRunId: facts.agentRunId,
		purpose: { type: 'revision-planning', revisionGateId: revisionGate.value.id },
		started: facts.started,
		profile: facts.profile,
	})
	return agentRun.ok ? { ok: true, value: { revisionGate: revisionGate.value, agentRun: agentRun.value, feedback: [] } } : agentRun
}

function revisionScopeFromReviewSurfaceScope(scope: ReviewSurfaceScope): RevisionScope {
	switch (scope.type) {
		case 'delivery':
			return { type: 'delivery-artifact', deliveryId: scope.deliveryId, deliveryArtifactId: scope.deliveryArtifactId }
		case 'slice':
			return { type: 'slice-artifact', sliceId: scope.sliceId, sliceArtifactId: scope.sliceArtifactId }
		default:
			throw new Error(`Unexpected Review Surface Scope: ${String(scope satisfies never)}`)
	}
}

function validateReviewSurfaceNotMerged(reviewSurface: ReviewSurface): CoreResult<void, ReviewSurfaceAlreadyMergedError> {
	return reviewSurface.closed?.type === 'merged'
		? { ok: false, error: { type: 'review-surface-already-merged', reviewSurfaceId: reviewSurface.id } }
		: { ok: true, value: undefined }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedAgentRunProfile, seedDelivery, seedSlice } =
		await import('../utils/test-helpers')

	describe('openRevisionGate command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.reviewSurfaces.fail.get = true
			const command = createOpenRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'openRevisionGate' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('opens a Delivery Revision Gate with empty fetched feedback until provider feedback fetching exists', async () => {
			const options = openDeliveryRevisionGateFixture()
			const command = createOpenRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command({ reviewSurfaceId: 'review-surface-1', agentRunProfileId: 'agent-run-profile-1' }, context)

			const expectedGate = deliveryRevisionGate()
			const expectedAgentRun = revisionPlanningAgentRun()
			expect(result).toEqual({ ok: true, value: { revisionGate: expectedGate, agentRun: expectedAgentRun, feedback: [] } })
			expect(options.tx.revisionGates.records.get('revision-gate-1')).toEqual(expectedGate)
			expect(options.tx.agentRuns.records.get('agent-run-1')).toEqual(expectedAgentRun)
			expect(options.tx.agentRunEvents.records.size).toBe(0)
		})

		it('opens a Slice Revision Gate with empty fetched feedback until provider feedback fetching exists', async () => {
			const options = openSliceRevisionGateFixture()
			const command = createOpenRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command({ reviewSurfaceId: 'review-surface-1', agentRunProfileId: 'agent-run-profile-1' }, context)

			expect(result).toMatchObject({
				ok: true,
				value: {
					revisionGate: {
						id: 'revision-gate-1',
						scope: { type: 'slice-artifact', sliceId: 'slice-1', sliceArtifactId: 'slice-artifact-1' },
					},
					agentRun: { agent: { type: 'model' }, purpose: { type: 'revision-planning', revisionGateId: 'revision-gate-1' } },
					feedback: [],
				},
			})
		})

		it('returns not-found when the Review Surface does not exist', async () => {
			const command = createOpenRevisionGateCommand(createTestCoreRuntime(createTestCoreServices()))

			const result = await command({ reviewSurfaceId: 'review-surface-1', agentRunProfileId: 'agent-run-profile-1' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'review-surface', id: 'review-surface-1' } })
		})

		it('rejects merged Review Surfaces', async () => {
			const options = openDeliveryRevisionGateFixture()
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
			const command = createOpenRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command({ reviewSurfaceId: 'review-surface-1', agentRunProfileId: 'agent-run-profile-1' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'review-surface-already-merged', reviewSurfaceId: 'review-surface-1' } })
		})
	})

	function openDeliveryRevisionGateFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, 'delivery-1')
		seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')
		options.tx.reviewSurfaces.records.set('review-surface-1', deliveryReviewSurface())
		return options
	}

	function openSliceRevisionGateFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, 'delivery-1')
		seedSlice(options.tx, 'slice-1', 'delivery-1')
		seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')
		options.tx.reviewSurfaces.records.set('review-surface-1', sliceReviewSurface())
		return options
	}

	function deliveryRevisionGate(): RevisionGate {
		return {
			id: 'revision-gate-1',
			scope: { type: 'delivery-artifact', deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
			reviewSurfaceId: 'review-surface-1',
			opened: localStamp(),
			closed: null,
		}
	}

	function revisionPlanningAgentRun(): AgentRun {
		return {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'revision-planning', revisionGateId: 'revision-gate-1' },
			profile: {
				agentRunProfileId: 'agent-run-profile-1',
				name: 'Agent Run Profile',
				modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
			},
			modelUseOverride: null,
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
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
