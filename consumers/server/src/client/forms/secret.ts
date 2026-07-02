import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type SecretCreationFormFields = {
	name: string
	value: string
}

type SecretCreationFormModel = {
	name: string
	value: string
}

const secretNamePipe = v.string().pipe(v.min<string>(1, 'Enter a Secret name'))
const secretValuePipe = v.string().pipe(v.min<string>(1, 'Enter a Secret value'))

export class SecretCreationFormDraft extends FormDraft<SecretCreationFormModel, SecretCreationFormModel, SecretCreationFormFields> {
	protected readonly rules = {
		name: secretNamePipe,
		value: secretValuePipe,
	}

	constructor() {
		super({ name: '', value: '' })
	}

	protected model = (): SecretCreationFormModel => ({ name: this.name, value: this.value })

	protected load = (entity: SecretCreationFormModel): void => {
		this.name = entity.name
		this.value = entity.value
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('SecretCreationFormDraft', () => {
		it('models Secret names and values without transforming visible fields', () => {
			const factory = new SecretCreationFormDraft()

			factory.name = '  GitHub PAT  '
			factory.value = '  token-value  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ name: '  GitHub PAT  ', value: '  token-value  ' })
		})

		it('rejects empty names and values', () => {
			const factory = new SecretCreationFormDraft().loadEntity({ name: 'Secret', value: 'value' })

			factory.name = ''
			factory.value = ''

			expect(factory.valid).toBe(false)
			expect(factory.errors.name).toBe('Enter a Secret name')
			expect(factory.errors.value).toBe('Enter a Secret value')
		})
	})
}
