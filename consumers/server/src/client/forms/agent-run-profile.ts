import { FormDraft, nestedFormDraftPipe, type FormDraftArray } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { RuntimeRequirementFormDraft } from './agent-run-runtime-requirements'
import { runtimeRequirementFormArray } from './agent-run-runtime-requirements'
import { AgentRunSandboxConfigFormDraft } from './agent-run-sandbox-config'
import { ModelUseFormDraft } from './model-use'
import type { AgentRunProfileInput, ModelUseConfig } from '../composables/core/server-api'

type AgentRunProfileFormFields = {
	name: string
	modelUse: ModelUseFormDraft
	runtimeRequirements: FormDraftArray<RuntimeRequirementFormDraft>
	sandboxConfig: AgentRunSandboxConfigFormDraft
}

export class AgentRunProfileFormDraft extends FormDraft<AgentRunProfileInput, AgentRunProfileInput, AgentRunProfileFormFields> {
	#secretOptions: readonly string[] | null = null

	protected readonly rules = {
		name: v.string().pipe(v.asTrimmed(), v.min<string>(1)),
		modelUse: nestedFormDraftPipe<ModelUseFormDraft>(),
		runtimeRequirements: v.array(nestedFormDraftPipe<RuntimeRequirementFormDraft>()),
		sandboxConfig: nestedFormDraftPipe<AgentRunSandboxConfigFormDraft>(),
	}

	constructor() {
		super({
			name: '',
			modelUse: new ModelUseFormDraft({ required: true }),
			runtimeRequirements: runtimeRequirementFormArray(),
			sandboxConfig: new AgentRunSandboxConfigFormDraft(),
		})
	}

	setSecretOptions(secretIds: readonly string[]): void {
		this.#secretOptions = [...secretIds]
		this.applySecretOptions()
	}

	clearSecretOptions(): void {
		this.#secretOptions = null
		this.applySecretOptions()
	}

	protected model = (): AgentRunProfileInput => ({
		name: this.name,
		modelUse: requireModelUse(this.modelUse.toModel()),
		runtimeRequirements: this.runtimeRequirements.toModel(),
		sandboxConfig: this.sandboxConfig.toModel(),
	})

	protected load = (entity: AgentRunProfileInput): void => {
		this.name = entity.name
		this.modelUse.loadEntity(entity.modelUse)
		this.runtimeRequirements.loadEntity(entity.runtimeRequirements)
		this.sandboxConfig.loadEntity(entity.sandboxConfig)
		this.applySecretOptions()
	}

	private applySecretOptions(): void {
		for (const requirement of this.runtimeRequirements) {
			if (this.#secretOptions === null) requirement.clearSecretOptions()
			else requirement.setSecretOptions(this.#secretOptions)
		}
		if (this.#secretOptions === null) this.sandboxConfig.clearSecretOptions()
		else this.sandboxConfig.setSecretOptions(this.#secretOptions)
	}
}

function requireModelUse(modelUse: ModelUseConfig | null): ModelUseConfig {
	if (modelUse === null) throw new Error('Agent Run Profile Model Use Config is required')
	return modelUse
}
