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

	const revisionGateId = nextId(runtime.values)
	if (!revisionGateId.ok) return revisionGateId

	const agentRunId = nextId(runtime.values)
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

			const result = await command(
				{ reviewSurfaceId: '01k00000000000000000000037', agentRunProfileId: '01k00000000000000000000006' },
				context,
			)

			const expectedGate = deliveryRevisionGate()
			const expectedAgentRun = revisionPlanningAgentRun()
			expect(result).toEqual({ ok: true, value: { revisionGate: expectedGate, agentRun: expectedAgentRun, feedback: [] } })
			expect(options.tx.revisionGates.records.get('01k00000000000000000010001')).toEqual(expectedGate)
			expect(options.tx.agentRuns.records.get('01k00000000000000000010002')).toEqual(expectedAgentRun)
			expect(options.tx.agentRunEvents.records.size).toBe(0)
		})

		it('opens a Slice Revision Gate with empty fetched feedback until provider feedback fetching exists', async () => {
			const options = openSliceRevisionGateFixture()
			const command = createOpenRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command(
				{ reviewSurfaceId: '01k00000000000000000000037', agentRunProfileId: '01k00000000000000000000006' },
				context,
			)

			expect(result).toMatchObject({
				ok: true,
				value: {
					revisionGate: {
						id: '01k00000000000000000010001',
						scope: {
							type: 'slice-artifact',
							sliceId: '01k00000000000000000000042',
							sliceArtifactId: '01k00000000000000000000045',
						},
					},
					agentRun: {
						agent: { type: 'model' },
						purpose: { type: 'revision-planning', revisionGateId: '01k00000000000000000010001' },
					},
					feedback: [],
				},
			})
		})

		it('returns not-found when the Review Surface does not exist', async () => {
			const command = createOpenRevisionGateCommand(createTestCoreRuntime(createTestCoreServices()))

			const result = await command(
				{ reviewSurfaceId: '01k00000000000000000000037', agentRunProfileId: '01k00000000000000000000006' },
				context,
			)

			expect(result).toEqual({
				ok: false,
				error: { type: 'not-found', resource: 'review-surface', id: '01k00000000000000000000037' },
			})
		})

		it('rejects merged Review Surfaces', async () => {
			const options = openDeliveryRevisionGateFixture()
			options.tx.reviewSurfaces.records.get('01k00000000000000000000037')!.closed = {
				type: 'merged',
				merged: { at: '2026-06-10T12:00:00.000Z' },
				config: {
					type: 'source-control',
					repositoryId: '01k00000000000000000000034',
					sourceBranch: 'delivery-branch',
					targetBranch: 'main',
				},
			}
			const command = createOpenRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command(
				{ reviewSurfaceId: '01k00000000000000000000037', agentRunProfileId: '01k00000000000000000000006' },
				context,
			)

			expect(result).toEqual({
				ok: false,
				error: { type: 'review-surface-already-merged', reviewSurfaceId: '01k00000000000000000000037' },
			})
		})
	})

	function openDeliveryRevisionGateFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, '01k00000000000000000000008')
		seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
		options.tx.reviewSurfaces.records.set('01k00000000000000000000037', deliveryReviewSurface())
		return options
	}

	function openSliceRevisionGateFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, '01k00000000000000000000008')
		seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')
		seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
		options.tx.reviewSurfaces.records.set('01k00000000000000000000037', sliceReviewSurface())
		return options
	}

	function deliveryRevisionGate(): RevisionGate {
		return {
			id: '01k00000000000000000010001',
			scope: {
				type: 'delivery-artifact',
				deliveryId: '01k00000000000000000000008',
				deliveryArtifactId: '01k00000000000000000000010',
			},
			reviewSurfaceId: '01k00000000000000000000037',
			opened: localStamp(),
			closed: null,
		}
	}

	function revisionPlanningAgentRun(): AgentRun {
		return {
			id: '01k00000000000000000010002',
			agent: { type: 'model' },
			purpose: { type: 'revision-planning', revisionGateId: '01k00000000000000000010001' },
			profile: {
				agentRunProfileId: '01k00000000000000000000006',
				name: 'Agent Run Profile',
				modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
				runtimeRequirements: [],
			},
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: { type: 'sandbox-preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
			sandbox: { assignment: null, appliedRequirements: [], appliedThroughEventId: null, released: null },
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
	}

	function deliveryReviewSurface(): ReviewSurface {
		return {
			id: '01k00000000000000000000037',
			scope: { type: 'delivery', deliveryId: '01k00000000000000000000008', deliveryArtifactId: '01k00000000000000000000010' },
			config: {
				provider: 'github',
				pullRequestNumber: 1,
				repositoryId: '01k00000000000000000000034',
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
			id: '01k00000000000000000000037',
			scope: { type: 'slice', sliceId: '01k00000000000000000000042', sliceArtifactId: '01k00000000000000000000045' },
			config: {
				provider: 'github',
				pullRequestNumber: 1,
				repositoryId: '01k00000000000000000000034',
				sourceBranch: 'slice-branch',
				targetBranch: 'delivery-branch',
			},
			title: 'Slice',
			closed: null,
			created: { at: '2026-06-10T12:00:00.000Z' },
		}
	}
}
