import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type PlanCreationFormFields = {
	title: string
}

type PlanCreationFormModel = {
	title: string
}

const planTitlePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a Plan title'))

export class PlanCreationFormDraft extends FormDraft<PlanCreationFormModel, PlanCreationFormModel, PlanCreationFormFields> {
	protected readonly rules = {
		title: planTitlePipe,
	}

	constructor() {
		super({ title: '' })
	}

	protected model = (): PlanCreationFormModel => ({ title: this.title })

	protected load = (entity: PlanCreationFormModel): void => {
		this.title = entity.title
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('PlanCreationFormDraft', () => {
		it('trims and models valid Plan titles', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = '  Repository setup plan  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ title: 'Repository setup plan' })
		})

		it('rejects empty Plan titles', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = '  '

			expect(factory.valid).toBe(false)
			expect(factory.errors.title).toBe('Enter a Plan title')
		})
	})
}
