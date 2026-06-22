import { v } from 'valleyed'

import { BaseFactory } from './factory'

type ProjectCreationFormFields = {
	title: string
}

type ProjectCreationFormModel = {
	title: string
}

const projectTitlePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a Project title'))

export class ProjectCreationFormFactory extends BaseFactory<ProjectCreationFormModel, ProjectCreationFormModel, ProjectCreationFormFields> {
	protected readonly rules = {
		title: projectTitlePipe,
	}

	constructor() {
		super({ title: '' })
		this.initialize()
	}

	protected model = (): ProjectCreationFormModel => ({ title: this.title })

	protected load = (entity: ProjectCreationFormModel): void => {
		this.title = entity.title
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ProjectCreationFormFactory', () => {
		it('trims and models valid Project titles', () => {
			const factory = new ProjectCreationFormFactory()

			factory.title = '  Delivery Ops  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ title: 'Delivery Ops' })
		})

		it('rejects empty Project titles', () => {
			const factory = new ProjectCreationFormFactory()

			factory.title = '  '

			expect(factory.valid).toBe(false)
			expect(factory.errors.title).toBe('Enter a Project title')
		})
	})
}
