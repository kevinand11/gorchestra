import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRun } from '../domain/agent-run'
import { idPipe, type AuditStamp, type Id, type RuntimeRecord } from '../domain/commons'
import type { FetchedFeedback, ReviewSurface, ReviewSurfaceScope } from '../domain/review-surface'
import type { RevisionGate, RevisionScope } from '../domain/revision'
import type { ArchivedSecretReferenceError, InvalidInputError, ReviewSurfaceAlreadyMergedError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { sourceControlRevisionPlanningInstruction } from '../runtime/agent-runs/instructions'
import type { CoreStorage } from '../services'
import { createInstructedModelAgentRunAndRequestPreparation } from '../utils/agent-runs'
import type { CoreRuntimeValues } from '../utils/runtime-values'
import type { Result as CoreResult } from '../utils/types'
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

export type Error =
	| InvalidInputError
	| ConfigCommandReferenceError
	| ConfigCommandStorageError
	| ReviewSurfaceAlreadyMergedError
	| ArchivedSecretReferenceError
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
	runtimeValues: CoreRuntimeValues
}

type OpenRevisionGateWrite = {
	result: Result
	dispatchMarkers: string[]
}

async function handleOpenRevisionGate(runtime: CoreRuntime, input: Input, context: CommandContext): Promise<CoreResult<Result, Error>> {
	const values = openRevisionGateRuntimeValues(runtime, context)
	if (!values.ok) return values

	const written = await withTransaction(runtime.services, (storage) => openRevisionGate(runtime, storage, input, values.value))
	if (!written.ok) return written

	for (const dispatchMarker of written.value.dispatchMarkers) runtime.services.dispatcher.ready(dispatchMarker)
	return { ok: true, value: written.value.result }
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
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	values: OpenRevisionGateRuntimeValues,
): Promise<CoreResult<OpenRevisionGateWrite, Exclude<Error, InvalidInputError>>> {
	const facts = await openRevisionGateFacts(storage, input, values)
	return facts.ok ? writeOpenRevisionGateFacts(runtime, storage, facts.value) : facts
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
		runtimeValues: values.runtimeValues,
	}
}

async function writeOpenRevisionGateFacts(
	runtime: CoreRuntime,
	storage: CoreStorage,
	facts: OpenRevisionGateFacts,
): Promise<CoreResult<OpenRevisionGateWrite, Exclude<Error, InvalidInputError>>> {
	const revisionGate = await createRecordValue('revision-gate', storage, facts.revisionGate)
	if (!revisionGate.ok) return revisionGate

	const created = await createInstructedModelAgentRunAndRequestPreparation(
		{ values: facts.runtimeValues, dispatcher: runtime.services.dispatcher },
		storage,
		{
			agentRunId: facts.agentRunId,
			purpose: { type: 'revision-planning', revisionGateId: revisionGate.value.id },
			started: facts.started,
			profile: facts.profile,
			instruction: sourceControlRevisionPlanningInstruction(),
		},
	)
	return created.ok
		? {
				ok: true,
				value: {
					result: { revisionGate: revisionGate.value, agentRun: created.value.agentRun, feedback: [] },
					dispatchMarkers: [created.value.preparationDispatchMarker],
				},
			}
		: created
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
	const {
		context,
		createTestCoreRuntime,
		createTestCoreServices,
		defaultAgentRunSandboxConfig,
		localStamp,
		seedAgentRunProfile,
		seedDelivery,
		seedSlice,
	} = await import('../utils/test-helpers')

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
			expect(options.tx.agentRunEvents.records.get('01k00000000000000000010003')?.body).toEqual(revisionPlanningInstructionBody())
		})

		it('requests Agent Run preparation only and readies it after commit', async () => {
			const dispatches: unknown[] = []
			const readyMarkers: string[] = []
			const options = openDeliveryRevisionGateFixture(
				createTestCoreServices({
					dispatcher: {
						preflight: () => Promise.resolve({ ok: true }),
						request: (request) => {
							dispatches.push(request)
							return Promise.resolve('marker-1')
						},
						ready: (marker) => {
							readyMarkers.push(marker)
						},
					},
				}),
			)
			const command = createOpenRevisionGateCommand(createTestCoreRuntime(options))

			const result = await command(
				{ reviewSurfaceId: '01k00000000000000000000037', agentRunProfileId: '01k00000000000000000000006' },
				context,
			)

			expect(result).toMatchObject({ ok: true })
			expect(dispatches).toEqual([
				{
					type: 'agent-run-preparation',
					agentRunId: '01k00000000000000000010002',
					coordinationClaims: [
						{
							scope: [{ type: 'agent-run', id: '01k00000000000000000010002' }],
							mode: { type: 'exclusive' },
						},
					],
					reason: { type: 'agent-run-created' },
				},
			])
			expect(readyMarkers).toEqual(['marker-1'])
			expect(options.tx.agentRunEvents.records.get('01k00000000000000000010003')?.body).toEqual(revisionPlanningInstructionBody())
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

	function openDeliveryRevisionGateFixture(options = createTestCoreServices()) {
		seedDelivery(options.tx, '01k00000000000000000000008')
		seedDeliveryArtifact(options, '01k00000000000000000000010', '01k00000000000000000000008')
		seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
		options.tx.reviewSurfaces.records.set('01k00000000000000000000037', deliveryReviewSurface())
		return options
	}

	function openSliceRevisionGateFixture(options = createTestCoreServices()) {
		seedDelivery(options.tx, '01k00000000000000000000008')
		seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')
		seedSliceArtifact(options, '01k00000000000000000000045', '01k00000000000000000000042')
		seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
		options.tx.reviewSurfaces.records.set('01k00000000000000000000037', sliceReviewSurface())
		return options
	}

	function seedDeliveryArtifact(options: ReturnType<typeof createTestCoreServices>, id: string, deliveryId: string) {
		options.tx.deliveryArtifacts.records.set(id, {
			id,
			deliveryId,
			config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
			created: { at: '2026-06-10T12:00:00.000Z' },
		})
	}

	function seedSliceArtifact(options: ReturnType<typeof createTestCoreServices>, id: string, sliceId: string) {
		options.tx.sliceArtifacts.records.set(id, {
			id,
			sliceId,
			config: { type: 'source-control', sliceBranch: 'slice-branch' },
			created: { at: '2026-06-10T12:00:00.000Z' },
		})
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
				sandboxConfig: defaultAgentRunSandboxConfig(),
			},
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: { type: 'preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
			sandbox: null,
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
	}

	function revisionPlanningInstructionBody() {
		return {
			type: 'instruction-snapshot',
			instruction: { type: 'source-control-revision-planning', version: 1 },
			parts: [
				{
					type: 'text',
					text: 'Plan revision work for this Source Control Project when prompted.',
					metadata: null,
				},
			],
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
