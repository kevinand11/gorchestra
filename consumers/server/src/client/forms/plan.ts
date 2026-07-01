import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type PlanCreationFormFields = {
	title: string
	initialMessage: string
}

type PlanCreationFormModel = {
	title: string
	initialMessage: string
}

const planTitlePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a Plan title'))
const initialMessagePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter an initial planning message'))

export class PlanCreationFormDraft extends FormDraft<PlanCreationFormModel, PlanCreationFormModel, PlanCreationFormFields> {
	protected readonly rules = {
		title: planTitlePipe,
		initialMessage: initialMessagePipe,
	}

	constructor() {
		super({ title: '', initialMessage: '' })
	}

	protected model = (): PlanCreationFormModel => ({ title: this.title, initialMessage: this.initialMessage })

	protected load = (entity: PlanCreationFormModel): void => {
		this.title = entity.title
		this.initialMessage = entity.initialMessage
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('PlanCreationFormDraft', () => {
		it('trims and models valid Plan creation input', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = '  Repository setup plan  '
			factory.initialMessage = '  Please plan repository onboarding.  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ title: 'Repository setup plan', initialMessage: 'Please plan repository onboarding.' })
		})

		it('rejects empty Plan creation input', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = '  '
			factory.initialMessage = '  '

			expect(factory.valid).toBe(false)
			expect(factory.errors.title).toBe('Enter a Plan title')
			expect(factory.errors.initialMessage).toBe('Enter an initial planning message')
		})
	})
}
