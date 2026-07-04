import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import { defaultDeliveryWorkConfig } from './project-config'
import type { ProjectConfigInput } from '../composables/core/server-api'

type ProjectCreationFormFields = {
	title: string
	executionAgentRunProfileId: string
	revisionExecutionAgentRunProfileId: string | null
	maxProcessableSliceSlots: number
	maxCorrectionRetriesPerFailure: number
}

type ProjectCreationFormModel = { title: string; config: ProjectConfigInput }

const titlePipe = v.string().pipe(v.min<string>(1, 'Enter a Project title'))
const requiredIdPipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Select an Agent Run Profile'))

export class ProjectCreationFormDraft extends FormDraft<ProjectCreationFormModel, ProjectCreationFormModel, ProjectCreationFormFields> {
	protected readonly rules = {
		title: titlePipe,
		executionAgentRunProfileId: requiredIdPipe,
		revisionExecutionAgentRunProfileId: v.nullable(v.string().pipe(v.asTrimmed())),
		maxProcessableSliceSlots: v.number().pipe(v.int(), v.gte(1)),
		maxCorrectionRetriesPerFailure: v.number().pipe(v.int(), v.gte(0)),
	}

	constructor() {
		super({ title: '', ...defaultDeliveryWorkConfig() })
	}

	protected model = (): ProjectCreationFormModel => ({
		title: this.title,
		config: {
			work: {
				maxProcessableSliceSlots: this.maxProcessableSliceSlots,
				maxCorrectionRetriesPerFailure: this.maxCorrectionRetriesPerFailure,
				executionAgentRunProfileId: this.executionAgentRunProfileId,
				revisionExecutionAgentRunProfileId: emptyToNull(this.revisionExecutionAgentRunProfileId),
			},
		},
	})

	protected load = (entity: ProjectCreationFormModel): void => {
		this.title = entity.title
		this.maxProcessableSliceSlots = entity.config.work.maxProcessableSliceSlots
		this.maxCorrectionRetriesPerFailure = entity.config.work.maxCorrectionRetriesPerFailure
		this.executionAgentRunProfileId = entity.config.work.executionAgentRunProfileId
		this.revisionExecutionAgentRunProfileId = entity.config.work.revisionExecutionAgentRunProfileId
	}
}

function emptyToNull(value: string | null): string | null {
	return value === null || value.trim().length === 0 ? null : value
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ProjectCreationFormDraft', () => {
		it('models valid Project creation input without transforming visible title', () => {
			const factory = new ProjectCreationFormDraft()

			factory.title = '  Delivery Ops  '
			factory.executionAgentRunProfileId = 'agent-run-profile-1'

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				title: '  Delivery Ops  ',
				config: { work: defaultDeliveryWorkConfig('agent-run-profile-1') },
			})
		})

		it('rejects empty Project creation input', () => {
			const factory = new ProjectCreationFormDraft().loadEntity({
				title: 'Project',
				config: { work: defaultDeliveryWorkConfig('profile-1') },
			})

			factory.title = ''
			factory.executionAgentRunProfileId = ''

			expect(factory.valid).toBe(false)
			expect(factory.errors.title).toBe('Enter a Project title')
			expect(factory.errors.executionAgentRunProfileId).toBe('Select an Agent Run Profile')
		})
	})
}
