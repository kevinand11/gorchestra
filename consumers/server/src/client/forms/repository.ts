import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type RepositoryCreationFormFields = {
	owner: string
	name: string
	secretId: string
}

type RepositoryCreationFormModel = {
	config: {
		provider: 'github'
		owner: string
		name: string
		secretId: string
	}
}

const repositoryOwnerPipe = v.string().pipe(v.min<string>(1, 'Enter a GitHub owner'))
const repositoryNamePipe = v.string().pipe(v.min<string>(1, 'Enter a GitHub Repository name'))
const repositorySecretIdPipe = v.string().pipe(v.min<string>(1, 'Select a GitHub access Secret'))

export class RepositoryCreationFormDraft extends FormDraft<
	RepositoryCreationFormModel,
	RepositoryCreationFormModel,
	RepositoryCreationFormFields
> {
	protected readonly rules = {
		owner: repositoryOwnerPipe,
		name: repositoryNamePipe,
		secretId: repositorySecretIdPipe,
	}

	constructor() {
		super({ owner: '', name: '', secretId: '' })
	}

	protected model = (): RepositoryCreationFormModel => ({
		config: { provider: 'github', owner: this.owner, name: this.name, secretId: this.secretId },
	})

	protected load = (entity: RepositoryCreationFormModel): void => {
		this.owner = entity.config.owner
		this.name = entity.config.name
		this.secretId = entity.config.secretId
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('RepositoryCreationFormDraft', () => {
		it('models fixed GitHub provider config without transforming visible fields', () => {
			const factory = new RepositoryCreationFormDraft()

			factory.owner = '  octocat  '
			factory.name = '  Hello-World  '
			factory.secretId = 'secret-1'

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				config: { provider: 'github', owner: '  octocat  ', name: '  Hello-World  ', secretId: 'secret-1' },
			})
		})

		it('rejects empty GitHub target fields and missing Secret selection', () => {
			const factory = new RepositoryCreationFormDraft().loadEntity({
				config: { provider: 'github', owner: 'octocat', name: 'Hello-World', secretId: 'secret-1' },
			})

			factory.owner = ''
			factory.name = ''
			factory.secretId = ''

			expect(factory.valid).toBe(false)
			expect(factory.errors.owner).toBe('Enter a GitHub owner')
			expect(factory.errors.name).toBe('Enter a GitHub Repository name')
			expect(factory.errors.secretId).toBe('Select a GitHub access Secret')
		})
	})
}
