import { FormDraft, formDraftPipe, type FormDraftArray } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { RuntimeRequirementFormDraft } from './agent-run-runtime-requirements'
import { runtimeRequirementFormArray } from './agent-run-runtime-requirements'
import { ModelUseFormDraft } from './model-use'
import type { AgentRunProfileInput, ModelUseConfig } from '../composables/core/server-api'

type AgentRunProfileFormFields = {
	name: string
	modelUse: ModelUseFormDraft
	runtimeRequirements: FormDraftArray<RuntimeRequirementFormDraft>
}

export class AgentRunProfileFormDraft extends FormDraft<AgentRunProfileInput, AgentRunProfileInput, AgentRunProfileFormFields> {
	protected readonly rules = {
		name: v.string().pipe(v.asTrimmed(), v.min<string>(1)),
		modelUse: formDraftPipe<ModelUseFormDraft>(),
		runtimeRequirements: formDraftPipe<FormDraftArray<RuntimeRequirementFormDraft>>(),
	}

	constructor() {
		super({ name: '', modelUse: new ModelUseFormDraft({ required: true }), runtimeRequirements: runtimeRequirementFormArray() })
	}

	protected model = (): AgentRunProfileInput => ({
		name: this.name,
		modelUse: requireModelUse(this.modelUse.toModel()),
		runtimeRequirements: this.runtimeRequirements.toModel(),
	})

	protected load = (entity: AgentRunProfileInput): void => {
		this.name = entity.name
		this.modelUse.loadEntity(entity.modelUse)
		this.runtimeRequirements.loadEntity(entity.runtimeRequirements)
	}
}

function requireModelUse(modelUse: ModelUseConfig | null): ModelUseConfig {
	if (modelUse === null) throw new Error('Agent Run Profile Model Use Config is required')
	return modelUse
}
