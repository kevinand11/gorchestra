import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRun } from '../domain/agent-run'
import { idPipe } from '../domain/commons'
import type { FetchedFeedback, ReviewSurface } from '../domain/review-surface'
import type { RevisionGate } from '../domain/revision-gate'
import type { InvalidInputError, ResourceArchivedError, ReviewSurfaceAlreadyMergedError } from '../errors'
import { createModelAgentRunAndRequestPreparation } from '../utils/agent-runs'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from '../utils/command-errors'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, createRecordValue, getRequired, loadSelectableAgentRunProfile, nextId, runtimeRecord } from '../utils/command-storage'
import { withNotificationTransaction } from '../utils/notifications'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const openRevisionGateInputPipe = v.object({ reviewSurfaceId: idPipe, agentRunProfileId: idPipe })
export type Input = PipeOutput<typeof openRevisionGateInputPipe>

export interface Result {
	revisionGate: RevisionGate

	/** Fetched from current Review Surface; not stored as authoritative Portfolio data. */
	feedback: FetchedFeedback[]
}

export type Error =
	| InvalidInputError
	| ConfigCommandReferenceError
	| ConfigCommandStorageError
	| ReviewSurfaceAlreadyMergedError
	| ResourceArchivedError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type OpenRevisionGateWrite = {
	result: Result
	dispatchMarkers: string[]
}

export function createOpenRevisionGateCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('openRevisionGate', openRevisionGateInputPipe, async (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return stamp

		const revisionGateId = nextId(runtime.values)
		if (!revisionGateId.ok) return revisionGateId

		const agentRunId = nextId(runtime.values)
		if (!agentRunId.ok) return agentRunId

		const started = runtimeRecord(runtime.values)
		if (!started.ok) return started

		const written = await withNotificationTransaction<OpenRevisionGateWrite, Exclude<Error, InvalidInputError>>(
			runtime,
			async (storage, notifications) => {
				const reviewSurface = await getRequired('review-surface', storage, input.reviewSurfaceId)
				if (!reviewSurface.ok) return reviewSurface
				if (reviewSurface.value.closed?.type === 'merged') {
					return {
						ok: false,
						error: { type: 'review-surface-already-merged', reviewSurfaceId: reviewSurface.value.id },
					}
				}

				let projectId: string
				switch (reviewSurface.value.scope.type) {
					case 'delivery': {
						const delivery = await getRequired('delivery', storage, reviewSurface.value.scope.deliveryId)
						if (!delivery.ok) return delivery
						projectId = delivery.value.projectId
						break
					}
					case 'slice': {
						const slice = await getRequired('slice', storage, reviewSurface.value.scope.sliceId)
						if (!slice.ok) return slice
						const sliceDelivery = await getRequired('delivery', storage, slice.value.deliveryId)
						if (!sliceDelivery.ok) return sliceDelivery
						projectId = sliceDelivery.value.projectId
						break
					}
					default:
						throw new Error(`Unrecognized review surface scope type: ${String(reviewSurface.value.scope satisfies never)}`)
				}

				const project = await getRequired('project', storage, projectId)
				if (!project.ok) return project

				const profile = await loadSelectableAgentRunProfile(storage, input.agentRunProfileId)
				if (!profile.ok) return profile

				let revisionScope: RevisionGate['scope']
				switch (reviewSurface.value.scope.type) {
					case 'delivery':
						revisionScope = {
							type: 'delivery-artifact',
							deliveryId: reviewSurface.value.scope.deliveryId,
							deliveryArtifactId: reviewSurface.value.scope.deliveryArtifactId,
						}
						break
					case 'slice':
						revisionScope = {
							type: 'slice-artifact',
							sliceId: reviewSurface.value.scope.sliceId,
							sliceArtifactId: reviewSurface.value.scope.sliceArtifactId,
						}
						break
					default:
						throw new Error(`Unexpected Review Surface Scope: ${String(reviewSurface.value.scope satisfies never)}`)
				}

				const revisionGate = await createRecordValue('revision-gate', storage, {
					id: revisionGateId.value,
					agentRunId: agentRunId.value,
					scope: revisionScope,
					reviewSurfaceId: reviewSurface.value.id,
					opened: stamp.value,
					closed: null,
				})
				if (!revisionGate.ok) return revisionGate

				const created = await createModelAgentRunAndRequestPreparation(
					{ values: runtime.values, dispatcher: runtime.services.dispatcher, notifications },
					storage,
					{
						agentRunId: agentRunId.value,
						purpose: { type: 'revision-planning', revisionGateId: revisionGate.value.id },
						started: started.value,
						agentRunProfile: profile.value,
						project: project.value,
					},
				)
				return created.ok
					? {
							ok: true,
							value: {
								result: { revisionGate: revisionGate.value, feedback: [] },
								dispatchMarkers: [created.value.preparationDispatchMarker],
							},
						}
					: created
			},
		)
		if (!written.ok) return written

		for (const dispatchMarker of written.value.dispatchMarkers) runtime.services.dispatcher.ready(dispatchMarker)
		return { ok: true, value: written.value.result }
	})
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
	const { ensureGitRequirement, globalRuntimeRequirements } = await import('../utils/agent-run-runtime-requirements')

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
			expect(result).toEqual({ ok: true, value: { revisionGate: expectedGate, feedback: [] } })
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
						agentRunId: '01k00000000000000000010002',
						scope: {
							type: 'slice-artifact',
							sliceId: '01k00000000000000000000042',
							sliceArtifactId: '01k00000000000000000000045',
						},
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
			agentRunId: '01k00000000000000000010002',
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
			toolSet: toolSet(['read', 'grep', 'find', 'ls', 'propose-revision-output']),
			modelUseOverride: null,
			sourceRuntimeRequirements: [...globalRuntimeRequirements, ensureGitRequirement],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [...globalRuntimeRequirements, ensureGitRequirement],
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

	function toolSet(names: string[]) {
		return names.map((name) => ({ name, contractVersion: 1 }))
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
