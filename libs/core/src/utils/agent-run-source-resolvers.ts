import type { Result } from './types'
import type { AgentRunPurpose } from '../domain/agent-run'
import {
	firstDuplicateRuntimeRequirement,
	type AgentRunRuntimeRequirement,
	type AgentRunRuntimeRequirements,
} from '../domain/agent-run-runtime'
import type { DeliveryArtifact, SliceArtifact } from '../domain/artifact'
import type { Id } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { Project } from '../domain/project'
import type { RevisionScope } from '../domain/revision'
import type { InvalidCoreServiceOutputError, InvariantViolationError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreStorage } from '../services'
import { getRequired } from '../storage/helpers'

export type ResolveAgentRunSourceRuntimeRequirementsError =
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError

export async function resolveAgentRunSourceRuntimeRequirements(
	storage: CoreStorage,
	purpose: AgentRunPurpose,
): Promise<Result<AgentRunRuntimeRequirements, ResolveAgentRunSourceRuntimeRequirementsError>> {
	const project = await projectForAgentRunPurpose(storage, purpose)
	return project.ok ? sourceRuntimeRequirementsForProjectPurpose(project.value, purpose) : project
}

async function projectForAgentRunPurpose(
	storage: CoreStorage,
	purpose: AgentRunPurpose,
): Promise<Result<Project, ResolveAgentRunSourceRuntimeRequirementsError>> {
	switch (purpose.type) {
		case 'planning':
			return projectForPlanning(storage, purpose.planId)
		case 'revision-planning':
			return projectForRevisionGate(storage, purpose.revisionGateId)
		case 'execution':
			return projectForExecution(storage, purpose.deliveryId, purpose.sliceId)
		case 'revision-execution':
			return projectForRevision(storage, purpose.revisionId)
		default:
			throw new Error(`Unexpected Agent Run Purpose: ${String(purpose satisfies never)}`)
	}
}

async function projectForPlanning(
	storage: CoreStorage,
	planId: Id,
): Promise<Result<Project, ResolveAgentRunSourceRuntimeRequirementsError>> {
	const plan = await getRequired('plan', storage, planId)
	if (!plan.ok) return plan

	return getRequired('project', storage, plan.value.projectId)
}

async function projectForExecution(
	storage: CoreStorage,
	deliveryId: Id,
	sliceId: Id,
): Promise<Result<Project, ResolveAgentRunSourceRuntimeRequirementsError>> {
	const delivery = await getRequired('delivery', storage, deliveryId)
	if (!delivery.ok) return delivery

	const slice = await getRequired('slice', storage, sliceId)
	if (!slice.ok) return slice

	if (slice.value.deliveryId !== delivery.value.id) {
		return invariant(`Slice ${slice.value.id} does not belong to Delivery ${delivery.value.id}.`)
	}

	const project = await getRequired('project', storage, delivery.value.projectId)
	if (!project.ok) return project

	const deliverySource = validateDeliveryTargetMatchesProject(project.value, delivery.value)
	return deliverySource.ok ? { ok: true, value: project.value } : deliverySource
}

async function projectForRevisionGate(
	storage: CoreStorage,
	revisionGateId: Id,
): Promise<Result<Project, ResolveAgentRunSourceRuntimeRequirementsError>> {
	const revisionGate = await getRequired('revision-gate', storage, revisionGateId)
	return revisionGate.ok ? projectForRevisionScope(storage, revisionGate.value.scope) : revisionGate
}

async function projectForRevision(
	storage: CoreStorage,
	revisionId: Id,
): Promise<Result<Project, ResolveAgentRunSourceRuntimeRequirementsError>> {
	const revision = await getRequired('revision', storage, revisionId)
	return revision.ok ? projectForRevisionScope(storage, revision.value.scope) : revision
}

async function projectForRevisionScope(
	storage: CoreStorage,
	scope: RevisionScope,
): Promise<Result<Project, ResolveAgentRunSourceRuntimeRequirementsError>> {
	switch (scope.type) {
		case 'delivery-artifact':
			return projectForDeliveryArtifactScope(storage, scope.deliveryId, scope.deliveryArtifactId)
		case 'slice-artifact':
			return projectForSliceArtifactScope(storage, scope.sliceId, scope.sliceArtifactId)
		default:
			throw new Error(`Unexpected Revision Scope: ${String(scope satisfies never)}`)
	}
}

async function projectForDeliveryArtifactScope(
	storage: CoreStorage,
	deliveryId: Id,
	deliveryArtifactId: Id,
): Promise<Result<Project, ResolveAgentRunSourceRuntimeRequirementsError>> {
	const deliveryArtifact = await getRequired('delivery-artifact', storage, deliveryArtifactId)
	if (!deliveryArtifact.ok) return deliveryArtifact

	if (deliveryArtifact.value.deliveryId !== deliveryId) {
		return invariant(`Delivery Artifact ${deliveryArtifact.value.id} does not belong to Delivery ${deliveryId}.`)
	}

	const delivery = await getRequired('delivery', storage, deliveryId)
	if (!delivery.ok) return delivery

	const project = await getRequired('project', storage, delivery.value.projectId)
	if (!project.ok) return project

	const deliverySource = validateDeliveryTargetMatchesProject(project.value, delivery.value)
	if (!deliverySource.ok) return deliverySource

	const artifactSource = validateDeliveryArtifactMatchesProject(project.value, deliveryArtifact.value)
	return artifactSource.ok ? { ok: true, value: project.value } : artifactSource
}

async function projectForSliceArtifactScope(
	storage: CoreStorage,
	sliceId: Id,
	sliceArtifactId: Id,
): Promise<Result<Project, ResolveAgentRunSourceRuntimeRequirementsError>> {
	const sliceArtifact = await getRequired('slice-artifact', storage, sliceArtifactId)
	if (!sliceArtifact.ok) return sliceArtifact

	if (sliceArtifact.value.sliceId !== sliceId) {
		return invariant(`Slice Artifact ${sliceArtifact.value.id} does not belong to Slice ${sliceId}.`)
	}

	const slice = await getRequired('slice', storage, sliceId)
	if (!slice.ok) return slice

	const delivery = await getRequired('delivery', storage, slice.value.deliveryId)
	if (!delivery.ok) return delivery

	const project = await getRequired('project', storage, delivery.value.projectId)
	if (!project.ok) return project

	const sliceSource = validateSliceArtifactMatchesProject(project.value, sliceArtifact.value)
	if (!sliceSource.ok) return sliceSource

	const deliverySource = validateDeliveryTargetMatchesProject(project.value, delivery.value)
	return deliverySource.ok ? { ok: true, value: project.value } : deliverySource
}

function sourceRuntimeRequirementsForProjectPurpose(
	project: Project,
	purpose: AgentRunPurpose,
): Result<AgentRunRuntimeRequirements, InvariantViolationError> {
	switch (project.source.type) {
		case 'source-control':
			return sourceControlRuntimeRequirementsForPurpose(purpose)
		default:
			throw new Error(`Unexpected Project Source Type: ${String(project.source.type satisfies never)}`)
	}
}

function sourceControlRuntimeRequirementsForPurpose(
	purpose: AgentRunPurpose,
): Result<AgentRunRuntimeRequirements, InvariantViolationError> {
	switch (purpose.type) {
		case 'planning':
		case 'revision-planning':
		case 'execution':
		case 'revision-execution':
			return validateSourceRuntimeRequirements([])
		default:
			throw new Error(`Unexpected Agent Run Purpose: ${String(purpose satisfies never)}`)
	}
}

function validateDeliveryTargetMatchesProject(project: Project, delivery: Delivery): Result<void, InvariantViolationError> {
	switch (project.source.type) {
		case 'source-control':
			return delivery.target.type === 'source-control'
				? { ok: true, value: undefined }
				: invariant(`Delivery ${delivery.id} target does not match Project ${project.id} source type.`)
		default:
			throw new Error(`Unexpected Project Source Type: ${String(project.source.type satisfies never)}`)
	}
}

function validateDeliveryArtifactMatchesProject(project: Project, artifact: DeliveryArtifact): Result<void, InvariantViolationError> {
	switch (project.source.type) {
		case 'source-control':
			return artifact.config.type === 'source-control'
				? { ok: true, value: undefined }
				: invariant(`Delivery Artifact ${artifact.id} config does not match Project ${project.id} source type.`)
		default:
			throw new Error(`Unexpected Project Source Type: ${String(project.source.type satisfies never)}`)
	}
}

function validateSliceArtifactMatchesProject(project: Project, artifact: SliceArtifact): Result<void, InvariantViolationError> {
	switch (project.source.type) {
		case 'source-control':
			return artifact.config.type === 'source-control'
				? { ok: true, value: undefined }
				: invariant(`Slice Artifact ${artifact.id} config does not match Project ${project.id} source type.`)
		default:
			throw new Error(`Unexpected Project Source Type: ${String(project.source.type satisfies never)}`)
	}
}

function validateSourceRuntimeRequirements(
	requirements: AgentRunRuntimeRequirement[],
): Result<AgentRunRuntimeRequirements, InvariantViolationError> {
	const duplicate = firstDuplicateRuntimeRequirement(requirements)
	return duplicate === null
		? { ok: true, value: requirements }
		: invariant(`Source runtime requirements included duplicate requirement ${duplicate.type}.`)
}

function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, localStamp, seedDelivery, seedProject, seedSlice, stamp } = await import('./test-helpers')

	describe('resolveAgentRunSourceRuntimeRequirements', () => {
		it('resolves source-control planning source requirements through Plan to Project', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			options.tx.plans.records.set('01k00000000000000000000028', {
				id: '01k00000000000000000000028',
				projectId: '01k00000000000000000000030',
				title: 'Plan',
				created: localStamp(),
				closed: null,
			})

			await expect(
				resolveAgentRunSourceRuntimeRequirements(options.storage, {
					type: 'planning',
					planId: '01k00000000000000000000028',
				}),
			).resolves.toEqual({ ok: true, value: [] })
		})

		it('resolves source-control execution source requirements through Delivery and Slice to Project', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, '01k00000000000000000000008')
			seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')

			await expect(
				resolveAgentRunSourceRuntimeRequirements(options.storage, {
					type: 'execution',
					deliveryId: '01k00000000000000000000008',
					sliceId: '01k00000000000000000000042',
					mode: { type: 'initial' },
				}),
			).resolves.toEqual({ ok: true, value: [] })
		})

		it('returns an invariant violation when an execution Slice belongs to another Delivery', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, '01k00000000000000000000008')
			seedDelivery(options.tx, '01k00000000000000000000009')
			seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000009')

			await expect(
				resolveAgentRunSourceRuntimeRequirements(options.storage, {
					type: 'execution',
					deliveryId: '01k00000000000000000000008',
					sliceId: '01k00000000000000000000042',
					mode: { type: 'initial' },
				}),
			).resolves.toEqual({
				ok: false,
				error: {
					type: 'invariant-violation',
					message: 'Slice 01k00000000000000000000042 does not belong to Delivery 01k00000000000000000000008.',
				},
			})
		})

		it('resolves source-control revision planning source requirements through a Slice Artifact scope', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, '01k00000000000000000000008')
			seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')
			seedSliceArtifact(options.tx, '01k00000000000000000000045', '01k00000000000000000000042')
			options.tx.revisionGates.records.set('01k00000000000000000000046', {
				id: '01k00000000000000000000046',
				scope: {
					type: 'slice-artifact',
					sliceId: '01k00000000000000000000042',
					sliceArtifactId: '01k00000000000000000000045',
				},
				reviewSurfaceId: '01k00000000000000000000037',
				opened: stamp,
				closed: null,
			})

			await expect(
				resolveAgentRunSourceRuntimeRequirements(options.storage, {
					type: 'revision-planning',
					revisionGateId: '01k00000000000000000000046',
				}),
			).resolves.toEqual({ ok: true, value: [] })
		})

		it('resolves source-control revision execution source requirements through a Revision scope and ignores action id', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, '01k00000000000000000000008')
			seedDeliveryArtifact(options.tx, '01k00000000000000000000010', '01k00000000000000000000008')
			options.tx.revisions.records.set('01k00000000000000000000047', {
				id: '01k00000000000000000000047',
				revisionGateId: '01k00000000000000000000046',
				scope: {
					type: 'delivery-artifact',
					deliveryId: '01k00000000000000000000008',
					deliveryArtifactId: '01k00000000000000000000010',
				},
				instruction: { body: 'Revise.' },
				disposition: { body: 'Respond to feedback.' },
				accepted: stamp,
			})

			await expect(
				resolveAgentRunSourceRuntimeRequirements(options.storage, {
					type: 'revision-execution',
					revisionId: '01k00000000000000000000047',
					actionId: '01k00000000000000000000099',
				}),
			).resolves.toEqual({ ok: true, value: [] })
		})
	})

	describe('validateSourceRuntimeRequirements', () => {
		it('returns invariant violations for duplicate source requirements', () => {
			const requirement: AgentRunRuntimeRequirement = {
				type: 'environment-secret',
				envName: 'NPM_TOKEN',
				secretId: '01k00000000000000000000040',
			}

			expect(validateSourceRuntimeRequirements([requirement, requirement])).toEqual({
				ok: false,
				error: {
					type: 'invariant-violation',
					message: 'Source runtime requirements included duplicate requirement environment-secret.',
				},
			})
		})
	})

	function seedDeliveryArtifact(tx: ReturnType<typeof createTestCoreServices>['tx'], id: Id, deliveryId: Id) {
		tx.deliveryArtifacts.records.set(id, {
			id,
			deliveryId,
			config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
			created: { at: '2026-06-10T12:00:00.000Z' },
		})
	}

	function seedSliceArtifact(tx: ReturnType<typeof createTestCoreServices>['tx'], id: Id, sliceId: Id) {
		tx.sliceArtifacts.records.set(id, {
			id,
			sliceId,
			config: { type: 'source-control', sliceBranch: 'slice-branch' },
			created: { at: '2026-06-10T12:00:00.000Z' },
		})
	}
}
