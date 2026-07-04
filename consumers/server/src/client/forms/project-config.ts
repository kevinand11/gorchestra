import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { DeliveryWorkConfigInput, ProjectConfigInput } from '../composables/core/server-api'

export type ProjectConfigFormEntity = { config: ProjectConfigInput }
export type ProjectConfigFormModel = { config: ProjectConfigInput }

type ProjectConfigFormFields = {
	executionAgentRunProfileId: string
	revisionExecutionAgentRunProfileId: string | null
	maxProcessableSliceSlots: number
	maxCorrectionRetriesPerFailure: number
}

const positiveIntegerFieldPipe = v.number().pipe(v.int(), v.gte(1))
const nonNegativeIntegerFieldPipe = v.number().pipe(v.int(), v.gte(0))
const requiredIdPipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Select an Agent Run Profile'))

export class ProjectConfigFormDraft extends FormDraft<ProjectConfigFormEntity, ProjectConfigFormModel, ProjectConfigFormFields> {
	protected readonly rules = {
		executionAgentRunProfileId: requiredIdPipe,
		revisionExecutionAgentRunProfileId: v.nullable(v.string().pipe(v.asTrimmed())),
		maxProcessableSliceSlots: positiveIntegerFieldPipe,
		maxCorrectionRetriesPerFailure: nonNegativeIntegerFieldPipe,
	}

	constructor() {
		super(defaultDeliveryWorkConfig())
	}

	protected model = (): ProjectConfigFormModel => ({ config: { work: this.workConfig() } })

	protected load = (entity: ProjectConfigFormEntity): void => {
		this.setWorkFields(entity.config.work)
	}

	private workConfig(): DeliveryWorkConfigInput {
		return {
			maxProcessableSliceSlots: this.maxProcessableSliceSlots,
			maxCorrectionRetriesPerFailure: this.maxCorrectionRetriesPerFailure,
			executionAgentRunProfileId: this.executionAgentRunProfileId,
			revisionExecutionAgentRunProfileId: emptyToNull(this.revisionExecutionAgentRunProfileId),
		}
	}

	private setWorkFields(work: DeliveryWorkConfigInput): void {
		this.maxProcessableSliceSlots = work.maxProcessableSliceSlots
		this.maxCorrectionRetriesPerFailure = work.maxCorrectionRetriesPerFailure
		this.executionAgentRunProfileId = work.executionAgentRunProfileId
		this.revisionExecutionAgentRunProfileId = work.revisionExecutionAgentRunProfileId
	}
}

export function defaultDeliveryWorkConfig(agentRunProfileId = ''): DeliveryWorkConfigInput {
	return {
		maxProcessableSliceSlots: 1,
		maxCorrectionRetriesPerFailure: 1,
		executionAgentRunProfileId: agentRunProfileId,
		revisionExecutionAgentRunProfileId: null,
	}
}

function emptyToNull(value: string | null): string | null {
	return value === null || value.trim().length === 0 ? null : value
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ProjectConfigFormDraft', () => {
		it('models required Project work config with Agent Run Profile ids', () => {
			const draft = new ProjectConfigFormDraft()
			draft.executionAgentRunProfileId = 'agent-run-profile-1'
			draft.revisionExecutionAgentRunProfileId = 'agent-run-profile-2'
			draft.maxProcessableSliceSlots = 2
			draft.maxCorrectionRetriesPerFailure = 0

			expect(draft.toModel()).toEqual({
				config: {
					work: {
						maxProcessableSliceSlots: 2,
						maxCorrectionRetriesPerFailure: 0,
						executionAgentRunProfileId: 'agent-run-profile-1',
						revisionExecutionAgentRunProfileId: 'agent-run-profile-2',
					},
				},
			})
		})

		it('loads existing config and treats blank revision profile as null', () => {
			const draft = new ProjectConfigFormDraft().loadEntity({
				config: {
					work: {
						...defaultDeliveryWorkConfig('agent-run-profile-1'),
						revisionExecutionAgentRunProfileId: 'agent-run-profile-2',
					},
				},
			})

			draft.revisionExecutionAgentRunProfileId = ' '

			expect(draft.toModel()).toEqual({
				config: { work: { ...defaultDeliveryWorkConfig('agent-run-profile-1'), revisionExecutionAgentRunProfileId: null } },
			})
		})
	})
}
