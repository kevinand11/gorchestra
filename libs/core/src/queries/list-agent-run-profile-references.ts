import { v, type PipeOutput } from 'valleyed'

import { agentRunProfileReferencePipe, type AgentRunProfileReference, type AgentRunProfileReferenceRole } from '../domain/agent-run-profile'
import { idPipe, type Id } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { Project } from '../domain/project'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { getRequired, listRecords, withTransaction, type StorageBoundaryError } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({ agentRunProfileId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = v.array(agentRunProfileReferencePipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListAgentRunProfileReferencesQuery(options: CoreServices): Operation {
	return buildQueryHandler('listAgentRunProfileReferences', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const profile = await getRequired('agent-run-profile', storage, input.agentRunProfileId)
			if (!profile.ok) return profile

			const references = await listAgentRunProfileReferences(storage, profile.value.id)
			return references.ok ? { ok: true, value: sortAgentRunProfileReferences(references.value) } : references
		}),
	)
}

async function listAgentRunProfileReferences(
	storage: CoreStorage,
	agentRunProfileId: Id,
): Promise<CoreResult<AgentRunProfileReference[], StorageBoundaryError>> {
	const projects = await listRecords('project', storage)
	if (!projects.ok) return projects

	const deliveries = await listRecords('delivery', storage)
	return deliveries.ok
		? {
				ok: true,
				value: [
					...projects.value.flatMap((project) => projectConfigReferences(project, agentRunProfileId)),
					...deliveries.value.flatMap((delivery) => deliveryConfigReferences(delivery, agentRunProfileId)),
				],
			}
		: deliveries
}

function projectConfigReferences(project: Project, agentRunProfileId: Id): AgentRunProfileReference[] {
	return matchingWorkConfigRoles(project.config.value.work, agentRunProfileId).map((role) => ({
		type: 'project-config' as const,
		active: true,
		role,
		projectId: project.id,
		projectTitle: project.title,
	}))
}

function deliveryConfigReferences(delivery: Delivery, agentRunProfileId: Id): AgentRunProfileReference[] {
	const work = delivery.config?.value?.work
	if (work === undefined || work === null) return []

	return matchingWorkConfigRoles(work, agentRunProfileId).map((role) => ({
		type: 'delivery-config' as const,
		active: delivery.closed === null,
		role,
		projectId: delivery.projectId,
		deliveryId: delivery.id,
		deliveryTitle: delivery.title,
	}))
}

type WorkConfigWithAgentRunProfileSelection = {
	executionAgentRunProfileId: Id
	revisionExecutionAgentRunProfileId: Id | null
}

function matchingWorkConfigRoles(work: WorkConfigWithAgentRunProfileSelection, agentRunProfileId: Id): AgentRunProfileReferenceRole[] {
	const roles: AgentRunProfileReferenceRole[] = []
	if (work.executionAgentRunProfileId === agentRunProfileId) roles.push('execution')
	if (effectiveRevisionExecutionAgentRunProfileId(work) === agentRunProfileId) roles.push('revision-execution')
	return roles
}

function effectiveRevisionExecutionAgentRunProfileId(work: WorkConfigWithAgentRunProfileSelection): Id {
	return work.revisionExecutionAgentRunProfileId ?? work.executionAgentRunProfileId
}

function sortAgentRunProfileReferences(references: AgentRunProfileReference[]): AgentRunProfileReference[] {
	return [...references].sort(compareAgentRunProfileReferences)
}

function compareAgentRunProfileReferences(left: AgentRunProfileReference, right: AgentRunProfileReference): number {
	return firstNonZero([
		referenceActiveRank(left) - referenceActiveRank(right),
		referenceTypeOrder[left.type] - referenceTypeOrder[right.type],
		referenceLabel(left).localeCompare(referenceLabel(right)),
		referenceRoleOrder[left.role] - referenceRoleOrder[right.role],
		referenceId(left).localeCompare(referenceId(right)),
	])
}

function firstNonZero(values: number[]): number {
	return values.find((value) => value !== 0) ?? 0
}

const referenceTypeOrder: Record<AgentRunProfileReference['type'], number> = {
	'project-config': 0,
	'delivery-config': 1,
}

const referenceRoleOrder: Record<AgentRunProfileReferenceRole, number> = {
	execution: 0,
	'revision-execution': 1,
}

function referenceActiveRank(reference: Pick<AgentRunProfileReference, 'active'>): number {
	return reference.active ? 0 : 1
}

function referenceLabel(reference: AgentRunProfileReference): string {
	switch (reference.type) {
		case 'project-config':
			return reference.projectTitle
		case 'delivery-config':
			return reference.deliveryTitle
		default:
			throw new Error(`Unexpected Agent Run Profile Reference type: ${String(reference satisfies never)}`)
	}
}

function referenceId(reference: AgentRunProfileReference): string {
	switch (reference.type) {
		case 'project-config':
			return reference.projectId
		case 'delivery-config':
			return reference.deliveryId
		default:
			throw new Error(`Unexpected Agent Run Profile Reference type: ${String(reference satisfies never)}`)
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, defaultDeliveryWorkConfig, seedAgentRunProfile, seedDelivery, seedProject, stamp, testModelAgentRun } =
		await import('../utils/test-helpers')

	describe('listAgentRunProfileReferences query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRunProfiles.fail.get = true
			const query = createListAgentRunProfileReferencesQuery(options)

			const result = await query({ agentRunProfileId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listAgentRunProfileReferences' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the target Agent Run Profile does not exist', async () => {
			const query = createListAgentRunProfileReferencesQuery(createTestCoreServices())

			const result = await query({ agentRunProfileId: 'agent-run-profile-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'agent-run-profile', id: 'agent-run-profile-1' } })
		})

		it('returns Project Config references for execution and effective revision execution roles', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')
			seedProject(options.tx, 'project-1', defaultDeliveryWorkConfig('agent-run-profile-1'))
			options.tx.projects.records.get('project-1')!.title = 'Build API'
			seedProject(options.tx, 'project-2', {
				...defaultDeliveryWorkConfig('agent-run-profile-2'),
				revisionExecutionAgentRunProfileId: 'agent-run-profile-1',
			})
			options.tx.projects.records.get('project-2')!.title = 'Repair UI'
			const query = createListAgentRunProfileReferencesQuery(options)

			const result = await query({ agentRunProfileId: 'agent-run-profile-1' })

			expect(result).toEqual({
				ok: true,
				value: [
					{
						type: 'project-config',
						active: true,
						role: 'execution',
						projectId: 'project-1',
						projectTitle: 'Build API',
					},
					{
						type: 'project-config',
						active: true,
						role: 'revision-execution',
						projectId: 'project-1',
						projectTitle: 'Build API',
					},
					{
						type: 'project-config',
						active: true,
						role: 'revision-execution',
						projectId: 'project-2',
						projectTitle: 'Repair UI',
					},
				],
			})
		})

		it('returns Delivery Config references with closed Deliveries marked inactive', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')
			seedDelivery(options.tx, 'delivery-active')
			options.tx.deliveries.records.get('delivery-active')!.title = 'Active Delivery'
			options.tx.deliveries.records.get('delivery-active')!.config = {
				configured: stamp,
				value: { work: defaultDeliveryWorkConfig('agent-run-profile-1') },
			}
			seedDelivery(options.tx, 'delivery-closed')
			options.tx.deliveries.records.get('delivery-closed')!.title = 'Closed Delivery'
			options.tx.deliveries.records.get('delivery-closed')!.config = {
				configured: stamp,
				value: {
					work: {
						...defaultDeliveryWorkConfig('agent-run-profile-2'),
						revisionExecutionAgentRunProfileId: 'agent-run-profile-1',
					},
				},
			}
			options.tx.deliveries.records.get('delivery-closed')!.closed = {
				type: 'abandoned',
				abandoned: stamp,
				reason: 'No longer needed.',
			}
			const query = createListAgentRunProfileReferencesQuery(options)

			const result = await query({ agentRunProfileId: 'agent-run-profile-1' })

			expect(result).toEqual({
				ok: true,
				value: [
					{
						type: 'project-config',
						active: true,
						role: 'execution',
						projectId: 'project-1',
						projectTitle: 'Project',
					},
					{
						type: 'project-config',
						active: true,
						role: 'revision-execution',
						projectId: 'project-1',
						projectTitle: 'Project',
					},
					{
						type: 'delivery-config',
						active: true,
						role: 'execution',
						projectId: 'project-1',
						deliveryId: 'delivery-active',
						deliveryTitle: 'Active Delivery',
					},
					{
						type: 'delivery-config',
						active: true,
						role: 'revision-execution',
						projectId: 'project-1',
						deliveryId: 'delivery-active',
						deliveryTitle: 'Active Delivery',
					},
					{
						type: 'delivery-config',
						active: false,
						role: 'revision-execution',
						projectId: 'project-1',
						deliveryId: 'delivery-closed',
						deliveryTitle: 'Closed Delivery',
					},
				],
			})
		})

		it('excludes Agent Run profile snapshots because they are historical run state', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')
			options.tx.agentRuns.records.set(
				'agent-run-1',
				testModelAgentRun({
					id: 'agent-run-1',
					profile: {
						agentRunProfileId: 'agent-run-profile-1',
						name: 'Snapshot',
						modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
					},
				}),
			)
			options.tx.projects.records.clear()
			const query = createListAgentRunProfileReferencesQuery(options)

			const result = await query({ agentRunProfileId: 'agent-run-profile-1' })

			expect(result).toEqual({ ok: true, value: [] })
		})

		it('returns storage errors when reference reads fail', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')
			options.tx.projects.fail.list = true
			const query = createListAgentRunProfileReferencesQuery(options)

			const result = await query({ agentRunProfileId: 'agent-run-profile-1' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'project' } },
			})
		})
	})
}
