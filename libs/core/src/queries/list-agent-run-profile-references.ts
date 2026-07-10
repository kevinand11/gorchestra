import { v, type PipeOutput } from 'valleyed'

import { agentRunProfileReferencePipe, type AgentRunProfileReference, type AgentRunProfileReferenceRole } from '../domain/agent-run-profile'
import { idPipe, type Id } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { buildQueryHandler } from '../utils/query-handler'
import { getRequired, listRecords, withTransaction } from '../utils/storage/helpers'
import type { Result as CoreResult } from '../utils/types'

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

			const projects = await listRecords('project', storage)
			if (!projects.ok) return projects

			const deliveries = await listRecords('delivery', storage)
			if (!deliveries.ok) return deliveries

			const references: AgentRunProfileReference[] = [
				...projects.value.flatMap((project) =>
					matchingWorkConfigRoles(project.config.value.work, profile.value.id).map((role) => ({
						type: 'project-config' as const,
						active: true,
						role,
						projectId: project.id,
						projectTitle: project.title,
					})),
				),
				...deliveries.value.flatMap((delivery) => {
					const work = delivery.config?.value?.work
					return work === undefined || work === null
						? []
						: matchingWorkConfigRoles(work, profile.value.id).map((role) => ({
								type: 'delivery-config' as const,
								active: delivery.closed === null,
								role,
								projectId: delivery.projectId,
								deliveryId: delivery.id,
								deliveryTitle: delivery.title,
							}))
				}),
			]

			return {
				ok: true,
				value: [...references].sort(
					(left, right) =>
						[
							referenceActiveRank(left) - referenceActiveRank(right),
							referenceTypeOrder[left.type] - referenceTypeOrder[right.type],
							referenceLabel(left).localeCompare(referenceLabel(right)),
							referenceRoleOrder[left.role] - referenceRoleOrder[right.role],
							referenceId(left).localeCompare(referenceId(right)),
						].find((value) => value !== 0) ?? 0,
				),
			}
		}),
	)
}

type WorkConfigWithAgentRunProfileSelection = {
	executionAgentRunProfileId: Id
	revisionExecutionAgentRunProfileId: Id | null
}

function matchingWorkConfigRoles(work: WorkConfigWithAgentRunProfileSelection, agentRunProfileId: Id): AgentRunProfileReferenceRole[] {
	const roles: AgentRunProfileReferenceRole[] = []
	if (work.executionAgentRunProfileId === agentRunProfileId) roles.push('execution')
	if ((work.revisionExecutionAgentRunProfileId ?? work.executionAgentRunProfileId) === agentRunProfileId) {
		roles.push('revision-execution')
	}
	return roles
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
	const {
		createTestCoreServices,
		defaultAgentRunSandboxConfig,
		defaultDeliveryWorkConfig,
		seedAgentRunProfile,
		seedDelivery,
		seedProject,
		stamp,
		testModelAgentRun,
	} = await import('../utils/test-helpers')

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

			const result = await query({ agentRunProfileId: '01k00000000000000000000006' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'not-found', resource: 'agent-run-profile', id: '01k00000000000000000000006' },
			})
		})

		it('returns Project Config references for execution and effective revision execution roles', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
			seedProject(options.tx, '01k00000000000000000000030', defaultDeliveryWorkConfig('01k00000000000000000000006'))
			options.tx.projects.records.get('01k00000000000000000000030')!.title = 'Build API'
			seedProject(options.tx, '01k00000000000000000000031', {
				...defaultDeliveryWorkConfig('01k00000000000000000000007'),
				revisionExecutionAgentRunProfileId: '01k00000000000000000000006',
			})
			options.tx.projects.records.get('01k00000000000000000000031')!.title = 'Repair UI'
			const query = createListAgentRunProfileReferencesQuery(options)

			const result = await query({ agentRunProfileId: '01k00000000000000000000006' })

			expect(result).toEqual({
				ok: true,
				value: [
					{
						type: 'project-config',
						active: true,
						role: 'execution',
						projectId: '01k00000000000000000000030',
						projectTitle: 'Build API',
					},
					{
						type: 'project-config',
						active: true,
						role: 'revision-execution',
						projectId: '01k00000000000000000000030',
						projectTitle: 'Build API',
					},
					{
						type: 'project-config',
						active: true,
						role: 'revision-execution',
						projectId: '01k00000000000000000000031',
						projectTitle: 'Repair UI',
					},
				],
			})
		})

		it('returns Delivery Config references with closed Deliveries marked inactive', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
			seedDelivery(options.tx, '01k00000000000000000100034')
			options.tx.deliveries.records.get('01k00000000000000000100034')!.title = 'Active Delivery'
			options.tx.deliveries.records.get('01k00000000000000000100034')!.config = {
				configured: stamp,
				value: { work: defaultDeliveryWorkConfig('01k00000000000000000000006') },
			}
			seedDelivery(options.tx, 'delivery-closed')
			options.tx.deliveries.records.get('delivery-closed')!.title = 'Closed Delivery'
			options.tx.deliveries.records.get('delivery-closed')!.config = {
				configured: stamp,
				value: {
					work: {
						...defaultDeliveryWorkConfig('01k00000000000000000000007'),
						revisionExecutionAgentRunProfileId: '01k00000000000000000000006',
					},
				},
			}
			options.tx.deliveries.records.get('delivery-closed')!.closed = {
				type: 'abandoned',
				abandoned: stamp,
				reason: 'No longer needed.',
			}
			const query = createListAgentRunProfileReferencesQuery(options)

			const result = await query({ agentRunProfileId: '01k00000000000000000000006' })

			expect(result).toEqual({
				ok: true,
				value: [
					{
						type: 'project-config',
						active: true,
						role: 'execution',
						projectId: '01k00000000000000000000030',
						projectTitle: 'Project',
					},
					{
						type: 'project-config',
						active: true,
						role: 'revision-execution',
						projectId: '01k00000000000000000000030',
						projectTitle: 'Project',
					},
					{
						type: 'delivery-config',
						active: true,
						role: 'execution',
						projectId: '01k00000000000000000000030',
						deliveryId: '01k00000000000000000100034',
						deliveryTitle: 'Active Delivery',
					},
					{
						type: 'delivery-config',
						active: true,
						role: 'revision-execution',
						projectId: '01k00000000000000000000030',
						deliveryId: '01k00000000000000000100034',
						deliveryTitle: 'Active Delivery',
					},
					{
						type: 'delivery-config',
						active: false,
						role: 'revision-execution',
						projectId: '01k00000000000000000000030',
						deliveryId: 'delivery-closed',
						deliveryTitle: 'Closed Delivery',
					},
				],
			})
		})

		it('excludes Agent Run profile snapshots because they are historical run state', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
			options.tx.agentRuns.records.set(
				'01k00000000000000000000002',
				testModelAgentRun({
					id: '01k00000000000000000000002',
					profile: {
						agentRunProfileId: '01k00000000000000000000006',
						name: 'Snapshot',
						modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
						runtimeRequirements: [],
						sandboxConfig: defaultAgentRunSandboxConfig(),
					},
				}),
			)
			options.tx.projects.records.clear()
			const query = createListAgentRunProfileReferencesQuery(options)

			const result = await query({ agentRunProfileId: '01k00000000000000000000006' })

			expect(result).toEqual({ ok: true, value: [] })
		})

		it('returns storage errors when reference reads fail', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
			options.tx.projects.fail.list = true
			const query = createListAgentRunProfileReferencesQuery(options)

			const result = await query({ agentRunProfileId: '01k00000000000000000000006' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'project' } },
			})
		})
	})
}
