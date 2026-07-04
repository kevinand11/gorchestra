import { FormDraft, formDraftPipe } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import { ModelUseFormDraft } from './model-use'
import type { DeliveryWorkConfigInput, ProjectConfigInput } from '../composables/core/server-api'

export type ProjectConfigFormEntity = { config: ProjectConfigInput | null }
export type ProjectConfigFormModel = { config: ProjectConfigInput }

type ProjectConfigFormFields = {
	planningModelUse: ModelUseFormDraft
	revisionPlanningModelUse: ModelUseFormDraft
	executionModelUse: ModelUseFormDraft
	revisionExecutionModelUse: ModelUseFormDraft
	overridesWork: boolean
	maxProcessableSliceSlots: number
	maxCorrectionRetriesPerFailure: number
	modelTimeoutMs: number
}

type ProjectModelConfigInput = ProjectConfigInput['model']
type ProjectModelConfigFields = NonNullable<ProjectModelConfigInput>
type ProjectConfigFields = {
	model: ProjectModelConfigFields
	overridesWork: boolean
	work: DeliveryWorkConfigInput
}

const positiveIntegerFieldPipe = v.number().pipe(v.int(), v.gte(1))
const nonNegativeIntegerFieldPipe = v.number().pipe(v.int(), v.gte(0))

export class ProjectConfigFormDraft extends FormDraft<ProjectConfigFormEntity, ProjectConfigFormModel, ProjectConfigFormFields> {
	protected readonly rules = {
		planningModelUse: formDraftPipe<ModelUseFormDraft>(),
		revisionPlanningModelUse: formDraftPipe<ModelUseFormDraft>(),
		executionModelUse: formDraftPipe<ModelUseFormDraft>(),
		revisionExecutionModelUse: formDraftPipe<ModelUseFormDraft>(),
		overridesWork: v.boolean(),
		maxProcessableSliceSlots: positiveIntegerFieldPipe,
		maxCorrectionRetriesPerFailure: nonNegativeIntegerFieldPipe,
		modelTimeoutMs: positiveIntegerFieldPipe,
	}

	constructor() {
		super({
			planningModelUse: new ModelUseFormDraft(),
			revisionPlanningModelUse: new ModelUseFormDraft(),
			executionModelUse: new ModelUseFormDraft(),
			revisionExecutionModelUse: new ModelUseFormDraft(),
			overridesWork: false,
			...defaultDeliveryWorkConfig(),
		})
	}

	enableWorkOverrideFrom(work: DeliveryWorkConfigInput): void {
		this.setWorkFields(work)
		this.overridesWork = true
	}

	clearOverrides(work: DeliveryWorkConfigInput = defaultDeliveryWorkConfig()): void {
		this.planningModelUse.loadEntity(null)
		this.revisionPlanningModelUse.loadEntity(null)
		this.executionModelUse.loadEntity(null)
		this.revisionExecutionModelUse.loadEntity(null)
		this.setWorkFields(work)
		this.overridesWork = false
	}

	protected model = (): ProjectConfigFormModel => ({
		config: projectConfig(this.projectModelConfig(), this.projectWorkConfig()),
	})

	protected load = (entity: ProjectConfigFormEntity): void => {
		const fields = projectConfigFields(entity.config)

		this.planningModelUse.loadEntity(fields.model.planning)
		this.revisionPlanningModelUse.loadEntity(fields.model.revisionPlanning)
		this.executionModelUse.loadEntity(fields.model.execution)
		this.revisionExecutionModelUse.loadEntity(fields.model.revisionExecution)
		this.overridesWork = fields.overridesWork
		this.setWorkFields(fields.work)
	}

	private projectModelConfig(): ProjectModelConfigInput {
		const model = {
			planning: this.planningModelUse.toModel(),
			revisionPlanning: this.revisionPlanningModelUse.toModel(),
			execution: this.executionModelUse.toModel(),
			revisionExecution: this.revisionExecutionModelUse.toModel(),
		}
		return Object.values(model).every((value) => value === null) ? null : model
	}

	private projectWorkConfig(): DeliveryWorkConfigInput | null {
		return this.overridesWork
			? {
					maxProcessableSliceSlots: this.maxProcessableSliceSlots,
					maxCorrectionRetriesPerFailure: this.maxCorrectionRetriesPerFailure,
					modelTimeoutMs: this.modelTimeoutMs,
				}
			: null
	}

	private setWorkFields(work: DeliveryWorkConfigInput): void {
		this.maxProcessableSliceSlots = work.maxProcessableSliceSlots
		this.maxCorrectionRetriesPerFailure = work.maxCorrectionRetriesPerFailure
		this.modelTimeoutMs = work.modelTimeoutMs
	}
}

export function defaultDeliveryWorkConfig(): DeliveryWorkConfigInput {
	return { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 }
}

function projectConfig(model: ProjectModelConfigInput, work: DeliveryWorkConfigInput | null): ProjectConfigInput {
	return { model, work }
}

function projectConfigFields(config: ProjectConfigInput | null): ProjectConfigFields {
	return config === null
		? { model: emptyProjectModelConfig(), overridesWork: false, work: defaultDeliveryWorkConfig() }
		: {
				model: projectModelConfigFields(config.model),
				overridesWork: config.work !== null,
				work: config.work ?? defaultDeliveryWorkConfig(),
			}
}

function projectModelConfigFields(model: ProjectModelConfigInput): ProjectModelConfigFields {
	return model ?? emptyProjectModelConfig()
}

function emptyProjectModelConfig(): ProjectModelConfigFields {
	return { planning: null, revisionPlanning: null, execution: null, revisionExecution: null }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ProjectConfigFormDraft', () => {
		it('models all-inherited Project Config with null override fields', () => {
			const draft = new ProjectConfigFormDraft()

			expect(draft.toModel()).toEqual({ config: { model: null, work: null } })
		})

		it('folds all-null model overrides while retaining work overrides', () => {
			const draft = new ProjectConfigFormDraft()

			draft.enableWorkOverrideFrom({ maxProcessableSliceSlots: 2, maxCorrectionRetriesPerFailure: 0, modelTimeoutMs: 60_000 })

			expect(draft.toModel()).toEqual({
				config: { model: null, work: { maxProcessableSliceSlots: 2, maxCorrectionRetriesPerFailure: 0, modelTimeoutMs: 60_000 } },
			})
		})

		it('models Project Model overrides independently from work inheritance', () => {
			const draft = new ProjectConfigFormDraft()

			draft.planningModelUse.modelId.value = 'model-planning'
			draft.executionModelUse.modelId.value = 'model-execution'

			expect(draft.toModel()).toEqual({
				config: {
					model: {
						planning: { modelId: 'model-planning', thinkingLevel: 'none' },
						revisionPlanning: null,
						execution: { modelId: 'model-execution', thinkingLevel: 'none' },
						revisionExecution: null,
					},
					work: null,
				},
			})
		})

		it('loads null Project Config as clean inherited fields', () => {
			const draft = new ProjectConfigFormDraft()

			draft.loadEntity({ config: null })

			expect(draft.dirty).toBe(false)
			expect(draft.toModel()).toEqual({ config: { model: null, work: null } })
		})

		it('clears loaded overrides back to all-inherited config', () => {
			const draft = new ProjectConfigFormDraft().loadEntity({
				config: {
					model: {
						planning: { modelId: 'model-planning', thinkingLevel: 'none' },
						revisionPlanning: null,
						execution: null,
						revisionExecution: null,
					},
					work: { maxProcessableSliceSlots: 2, maxCorrectionRetriesPerFailure: 0, modelTimeoutMs: 60_000 },
				},
			})

			draft.clearOverrides({ maxProcessableSliceSlots: 3, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 45_000 })

			expect(draft.dirty).toBe(true)
			expect(draft.maxProcessableSliceSlots).toBe(3)
			expect(draft.toModel()).toEqual({ config: { model: null, work: null } })
		})
	})
}
