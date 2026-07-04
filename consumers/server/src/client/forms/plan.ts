import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type PlanCreationFormFields = {
	title: string
	initialMessage: string
	agentRunProfileId: string
}

type PlanCreationFormModel = {
	title: string
	initialMessage: string
	agentRunProfileId: string
}

const planTitlePipe = v.string().pipe(v.min<string>(1, 'Enter a Plan title'))
const initialMessagePipe = v.string().pipe(v.min<string>(1, 'Enter an initial planning message'))
const agentRunProfileIdPipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Select an Agent Run Profile'))

export class PlanCreationFormDraft extends FormDraft<PlanCreationFormModel, PlanCreationFormModel, PlanCreationFormFields> {
	protected readonly rules = { title: planTitlePipe, initialMessage: initialMessagePipe, agentRunProfileId: agentRunProfileIdPipe }

	constructor() {
		super({ title: '', initialMessage: '', agentRunProfileId: '' })
	}

	protected model = (): PlanCreationFormModel => ({
		title: this.title,
		initialMessage: this.initialMessage,
		agentRunProfileId: this.agentRunProfileId,
	})

	protected load = (entity: PlanCreationFormModel): void => {
		this.title = entity.title
		this.initialMessage = entity.initialMessage
		this.agentRunProfileId = entity.agentRunProfileId
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('PlanCreationFormDraft', () => {
		it('models valid Plan creation input without transforming visible fields', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = '  Repository setup plan  '
			factory.initialMessage = '  Please plan repository onboarding.  '
			factory.agentRunProfileId = 'agent-run-profile-1'

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				title: '  Repository setup plan  ',
				initialMessage: '  Please plan repository onboarding.  ',
				agentRunProfileId: 'agent-run-profile-1',
			})
		})

		it('rejects empty Plan creation input', () => {
			const factory = new PlanCreationFormDraft().loadEntity({
				title: 'Plan',
				initialMessage: 'Plan this.',
				agentRunProfileId: 'agent-run-profile-1',
			})

			factory.title = ''
			factory.initialMessage = ''
			factory.agentRunProfileId = ''

			expect(factory.valid).toBe(false)
			expect(factory.errors.title).toBe('Enter a Plan title')
			expect(factory.errors.initialMessage).toBe('Enter an initial planning message')
			expect(factory.errors.agentRunProfileId).toBe('Select an Agent Run Profile')
		})
	})
}
