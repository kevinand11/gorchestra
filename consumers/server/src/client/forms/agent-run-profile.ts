import { FormDraft, formDraftPipe } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import { ModelUseFormDraft } from './model-use'
import type { AgentRunProfileInput, ModelUseConfig } from '../composables/core/server-api'

type AgentRunProfileFormFields = { name: string; modelUse: ModelUseFormDraft }

export class AgentRunProfileFormDraft extends FormDraft<AgentRunProfileInput, AgentRunProfileInput, AgentRunProfileFormFields> {
	protected readonly rules = { name: v.string().pipe(v.asTrimmed(), v.min<string>(1)), modelUse: formDraftPipe<ModelUseFormDraft>() }

	constructor() {
		super({ name: '', modelUse: new ModelUseFormDraft({ required: true }) })
	}

	protected model = (): AgentRunProfileInput => ({ name: this.name, modelUse: requireModelUse(this.modelUse.toModel()) })

	protected load = (entity: AgentRunProfileInput): void => {
		this.name = entity.name
		this.modelUse.loadEntity(entity.modelUse)
	}
}

function requireModelUse(modelUse: ModelUseConfig | null): ModelUseConfig {
	if (modelUse === null) throw new Error('Agent Run Profile Model Use Config is required')
	return modelUse
}
