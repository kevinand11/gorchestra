import { v } from 'valleyed'

import { BaseFactory } from './factory'

type SecretCreationFormFields = {
	name: string
	value: string
}

type SecretCreationFormModel = {
	name: string
	value: string
}

const secretNamePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a Secret name'))
const secretValuePipe = v.string().pipe(v.custom<string>((value) => value.trim().length > 0, 'Enter a Secret value'))

export class SecretCreationFormFactory extends BaseFactory<SecretCreationFormModel, SecretCreationFormModel, SecretCreationFormFields> {
	protected readonly rules = {
		name: secretNamePipe,
		value: secretValuePipe,
	}

	constructor() {
		super({ name: '', value: '' })
		this.initialize()
	}

	protected model = (): SecretCreationFormModel => ({ name: this.name, value: this.value })

	protected load = (entity: SecretCreationFormModel): void => {
		this.name = entity.name
		this.value = entity.value
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('SecretCreationFormFactory', () => {
		it('trims names but preserves valid Secret values', () => {
			const factory = new SecretCreationFormFactory()

			factory.name = '  GitHub PAT  '
			factory.value = '  token-value  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ name: 'GitHub PAT', value: '  token-value  ' })
		})

		it('rejects empty names and blank values', () => {
			const factory = new SecretCreationFormFactory()

			factory.name = '  '
			factory.value = '  '

			expect(factory.valid).toBe(false)
			expect(factory.errors.name).toBe('Enter a Secret name')
			expect(factory.errors.value).toBe('Enter a Secret value')
		})
	})
}
