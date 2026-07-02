import { v, type PipeOutput } from 'valleyed'

import { idPipe, type Id } from '../domain/commons'
import type { ModelUseConfig } from '../domain/config'
import type { Delivery } from '../domain/delivery'
import { modelReferencePipe, type ModelReference, type ModelReferencePurpose } from '../domain/model'
import type { Plan } from '../domain/plan'
import type { Project } from '../domain/project'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { getPortfolioConfig, getRequired, listRecords, withTransaction, type StorageBoundaryError } from '../storage/helpers'
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

			const references = await listModelReferencesForModel(storage, model.value.id)
			return references.ok ? { ok: true, value: sortModelReferences(references.value) } : references
		}),
	)
}

type ModelReferenceLoader = (storage: CoreStorage, modelId: Id) => Promise<CoreResult<ModelReference[], StorageBoundaryError>>

const modelReferenceLoaders: readonly ModelReferenceLoader[] = [
	listPortfolioConfigModelReferences,
	listProjectConfigModelReferences,
	listPlanConfigModelReferences,
	listDeliveryConfigModelReferences,
]

async function listModelReferencesForModel(storage: CoreStorage, modelId: Id): Promise<CoreResult<ModelReference[], StorageBoundaryError>> {
	const references: ModelReference[] = []
	for (const loadReferences of modelReferenceLoaders) {
		const result = await loadReferences(storage, modelId)
		if (!result.ok) return result
		references.push(...result.value)
	}

	return { ok: true, value: references }
}

async function listPortfolioConfigModelReferences(
	storage: CoreStorage,
	modelId: Id,
): Promise<CoreResult<ModelReference[], StorageBoundaryError>> {
	const record = await getPortfolioConfig(storage)
	if (!record.ok) return record
	if (record.value === null) return { ok: true, value: [] }

	const config = record.value.value.model
	return {
		ok: true,
		value: [
			...modelUseConfigReferences(config.default, modelId, () => ({ type: 'portfolio-config', active: true, purpose: 'default' })),
			...modelUseConfigReferences(config.planning, modelId, () => ({ type: 'portfolio-config', active: true, purpose: 'planning' })),
			...modelUseConfigReferences(config.revisionPlanning, modelId, () => ({
				type: 'portfolio-config',
				active: true,
				purpose: 'revision-planning',
			})),
			...modelUseConfigReferences(config.execution, modelId, () => ({
				type: 'portfolio-config',
				active: true,
				purpose: 'execution',
			})),
			...modelUseConfigReferences(config.revisionExecution, modelId, () => ({
				type: 'portfolio-config',
				active: true,
				purpose: 'revision-execution',
			})),
		],
	}
}

async function listProjectConfigModelReferences(
	storage: CoreStorage,
	modelId: Id,
): Promise<CoreResult<ModelReference[], StorageBoundaryError>> {
	const projects = await listRecords('project', storage)
	return projects.ok ? { ok: true, value: projects.value.flatMap((project) => projectModelReferences(project, modelId)) } : projects
}

function projectModelReferences(project: Project, modelId: Id): ModelReference[] {
	const config = project.config?.value?.model ?? null
	if (config === null) return []

	return [
		...modelUseConfigReferences(config.planning, modelId, () => ({
			type: 'project-config',
			active: true,
			projectId: project.id,
			projectTitle: project.title,
			purpose: 'planning',
		})),
		...modelUseConfigReferences(config.revisionPlanning, modelId, () => ({
			type: 'project-config',
			active: true,
			projectId: project.id,
			projectTitle: project.title,
			purpose: 'revision-planning',
		})),
		...modelUseConfigReferences(config.execution, modelId, () => ({
			type: 'project-config',
			active: true,
			projectId: project.id,
			projectTitle: project.title,
			purpose: 'execution',
		})),
		...modelUseConfigReferences(config.revisionExecution, modelId, () => ({
			type: 'project-config',
			active: true,
			projectId: project.id,
			projectTitle: project.title,
			purpose: 'revision-execution',
		})),
	]
}

async function listPlanConfigModelReferences(
	storage: CoreStorage,
	modelId: Id,
): Promise<CoreResult<ModelReference[], StorageBoundaryError>> {
	const plans = await listRecords('plan', storage)
	return plans.ok ? { ok: true, value: plans.value.flatMap((plan) => planModelReferences(plan, modelId)) } : plans
}

function planModelReferences(plan: Plan, modelId: Id): ModelReference[] {
	const planning = plan.config?.value?.model?.planning ?? null
	return modelUseConfigReferences(planning, modelId, () => ({
		type: 'plan-config',
		active: true,
		projectId: plan.projectId,
		planId: plan.id,
		planTitle: plan.title,
		purpose: 'planning',
	}))
}

async function listDeliveryConfigModelReferences(
	storage: CoreStorage,
	modelId: Id,
): Promise<CoreResult<ModelReference[], StorageBoundaryError>> {
	const deliveries = await listRecords('delivery', storage)
	return deliveries.ok
		? { ok: true, value: deliveries.value.flatMap((delivery) => deliveryModelReferences(delivery, modelId)) }
		: deliveries
}

function deliveryModelReferences(delivery: Delivery, modelId: Id): ModelReference[] {
	const config = delivery.config?.value?.model ?? null
	if (config === null) return []

	return [
		...modelUseConfigReferences(config.execution, modelId, () => ({
			type: 'delivery-config',
			active: delivery.closed === null,
			projectId: delivery.projectId,
			deliveryId: delivery.id,
			deliveryTitle: delivery.title,
			purpose: 'execution',
		})),
		...modelUseConfigReferences(config.revisionExecution, modelId, () => ({
			type: 'delivery-config',
			active: delivery.closed === null,
			projectId: delivery.projectId,
			deliveryId: delivery.id,
			deliveryTitle: delivery.title,
			purpose: 'revision-execution',
		})),
	]
}

function modelUseConfigReferences<TReference extends ModelReference>(
	config: ModelUseConfig | null,
	modelId: Id,
	build: () => TReference,
): TReference[] {
	return config?.modelId === modelId ? [build()] : []
}

function sortModelReferences(references: ModelReference[]): ModelReference[] {
	return [...references].sort(compareModelReferences)
}

function compareModelReferences(left: ModelReference, right: ModelReference): number {
	return firstNonZero([
		referenceTypeOrder[left.type] - referenceTypeOrder[right.type],
		referenceActiveRank(left) - referenceActiveRank(right),
		referenceLabel(left).localeCompare(referenceLabel(right)),
		referencePurposeOrder[left.purpose] - referencePurposeOrder[right.purpose],
		referenceId(left).localeCompare(referenceId(right)),
	])
}

function firstNonZero(values: number[]): number {
	return values.find((value) => value !== 0) ?? 0
}

const referenceTypeOrder: Record<ModelReference['type'], number> = {
	'portfolio-config': 0,
	'project-config': 1,
	'plan-config': 2,
	'delivery-config': 3,
}

const referencePurposeOrder: Record<ModelReferencePurpose, number> = {
	default: 0,
	planning: 1,
	'revision-planning': 2,
	execution: 3,
	'revision-execution': 4,
}

function referenceActiveRank(reference: Pick<ModelReference, 'active'>): number {
	return reference.active ? 0 : 1
}

type ModelReferenceReader<T> = {
	[ReferenceType in ModelReference['type']]: (reference: Extract<ModelReference, { type: ReferenceType }>) => T
}

const referenceLabelByType: ModelReferenceReader<string> = {
	'portfolio-config': () => 'Portfolio Config',
	'project-config': (reference) => reference.projectTitle,
	'plan-config': (reference) => reference.planTitle,
	'delivery-config': (reference) => reference.deliveryTitle,
}

const referenceIdByType: ModelReferenceReader<string> = {
	'portfolio-config': () => '',
	'project-config': (reference) => reference.projectId,
	'plan-config': (reference) => reference.planId,
	'delivery-config': (reference) => reference.deliveryId,
}

function referenceLabel(reference: ModelReference): string {
	return referenceLabelByType[reference.type](reference as never)
}

function referenceId(reference: ModelReference): string {
	return referenceIdByType[reference.type](reference as never)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedProject, seedSelectableModel, stamp } = await import('../utils/test-helpers')

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

		it('returns direct config references ordered by config scope and active state', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, 'model-1')
			seedProject(options.tx, 'project-1')
			options.tx.projects.records.set('project-1', {
				...options.tx.projects.records.get('project-1')!,
				title: 'Project One',
				config: {
					configured: stamp,
					value: {
						model: {
							planning: { modelId: 'model-1', thinkingLevel: 'off' },
							revisionPlanning: null,
							execution: null,
							revisionExecution: null,
						},
						work: null,
					},
				},
			})
			options.tx.portfolioConfig.record = {
				configured: stamp,
				value: {
					model: {
						default: { modelId: 'model-1', thinkingLevel: 'off' },
						planning: null,
						revisionPlanning: null,
						execution: null,
						revisionExecution: null,
					},
					work: null,
				},
			}
			options.tx.plans.records.set('plan-1', {
				id: 'plan-1',
				projectId: 'project-1',
				title: 'Plan One',
				config: { configured: stamp, value: { model: { planning: { modelId: 'model-1', thinkingLevel: 'off' } } } },
				created: stamp,
			})
			options.tx.deliveries.records.set('delivery-active', {
				id: 'delivery-active',
				projectId: 'project-1',
				planId: 'plan-1',
				title: 'Active Delivery',
				target: { type: 'source-control', repositoryId: 'repository-1', targetBranch: 'main' },
				config: {
					configured: stamp,
					value: { model: { execution: { modelId: 'model-1', thinkingLevel: 'off' }, revisionExecution: null }, work: null },
				},
				accepted: stamp,
				queued: null,
				closed: null,
			})
			options.tx.deliveries.records.set('delivery-closed', {
				id: 'delivery-closed',
				projectId: 'project-1',
				planId: 'plan-1',
				title: 'Closed Delivery',
				target: { type: 'source-control', repositoryId: 'repository-1', targetBranch: 'main' },
				config: {
					configured: stamp,
					value: { model: { execution: { modelId: 'model-1', thinkingLevel: 'off' }, revisionExecution: null }, work: null },
				},
				accepted: stamp,
				queued: null,
				closed: { type: 'abandoned', abandoned: stamp, reason: 'Done.' },
			})
			const query = createListModelReferencesQuery(options)

			const result = await query({ modelId: 'model-1' })

			expect(result).toEqual({
				ok: true,
				value: [
					{ type: 'portfolio-config', active: true, purpose: 'default' },
					{
						type: 'project-config',
						active: true,
						projectId: 'project-1',
						projectTitle: 'Project One',
						purpose: 'planning',
					},
					{
						type: 'plan-config',
						active: true,
						projectId: 'project-1',
						planId: 'plan-1',
						planTitle: 'Plan One',
						purpose: 'planning',
					},
					{
						type: 'delivery-config',
						active: true,
						projectId: 'project-1',
						deliveryId: 'delivery-active',
						deliveryTitle: 'Active Delivery',
						purpose: 'execution',
					},
					{
						type: 'delivery-config',
						active: false,
						projectId: 'project-1',
						deliveryId: 'delivery-closed',
						deliveryTitle: 'Closed Delivery',
						purpose: 'execution',
					},
				],
			})
		})

		it('excludes inherited config and Agent Run transcript selection history', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, 'model-1')
			seedProject(options.tx, 'project-1')
			options.tx.portfolioConfig.record = {
				configured: stamp,
				value: {
					model: {
						default: { modelId: 'model-1', thinkingLevel: 'off' },
						planning: null,
						revisionPlanning: null,
						execution: null,
						revisionExecution: null,
					},
					work: null,
				},
			}
			options.tx.plans.records.set('plan-inherited', {
				id: 'plan-inherited',
				projectId: 'project-1',
				title: 'Inherited Plan',
				config: null,
				created: stamp,
			})
			options.tx.agentRuns.records.set('agent-run-1', {
				id: 'agent-run-1',
				agent: { type: 'model' },
				purpose: { type: 'planning', planId: 'plan-inherited' },
				started: { at: stamp.at },
				completed: null,
			})
			options.tx.agentRunEvents.records.set('agent-run-event-1', {
				id: 'agent-run-event-1',
				agentRunId: 'agent-run-1',
				sequence: 1,
				occurred: { at: stamp.at },
				body: { type: 'agent-run-model-selected', modelId: 'model-1', thinkingLevel: 'off', authorized: null },
			})
			const query = createListModelReferencesQuery(options)

			const result = await query({ modelId: 'model-1' })

			expect(result).toEqual({ ok: true, value: [{ type: 'portfolio-config', active: true, purpose: 'default' }] })
		})

		it('returns storage errors when reference reads fail', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, 'model-1')
			options.tx.projects.fail.list = true
			const query = createListModelReferencesQuery(options)

			const result = await query({ modelId: 'model-1' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'project' } },
			})
		})
	})
}
