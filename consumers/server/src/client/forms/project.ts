import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type ProjectCreationFormFields = {
	title: string
}

type ProjectCreationFormModel = {
	title: string
}

const projectTitlePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a Project title'))

export class ProjectCreationFormDraft extends FormDraft<ProjectCreationFormModel, ProjectCreationFormModel, ProjectCreationFormFields> {
	protected readonly rules = {
		title: projectTitlePipe,
	}

	constructor() {
		super({ title: '' })
	}

	protected model = (): ProjectCreationFormModel => ({ title: this.title })

	protected load = (entity: ProjectCreationFormModel): void => {
		this.title = entity.title
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ProjectCreationFormDraft', () => {
		it('trims and models valid Project titles', () => {
			const factory = new ProjectCreationFormDraft()

			factory.title = '  Delivery Ops  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ title: 'Delivery Ops' })
		})

		it('rejects empty Project titles', () => {
			const factory = new ProjectCreationFormDraft()

			factory.title = '  '

			expect(factory.valid).toBe(false)
			expect(factory.errors.title).toBe('Enter a Project title')
		})
	})
}
