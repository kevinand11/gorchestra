import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type EmailOtpChallengeFormFields = {
	email: string
}

type EmailOtpChallengeFormModel = {
	email: string
}

type EmailOtpVerificationFormFields = {
	email: string
	code: string
}

type EmailOtpVerificationFormModel = {
	email: string
	code: string
}

const emailPipe = v.string().pipe(v.asTrimmed(), v.email('Enter a valid email address'))
const emailOtpCodePipe = v.string().pipe(
	v.asTrimmed(),
	v.custom((code) => /^\d{6}$/.test(code), 'Enter the six-digit code'),
)

export class EmailOtpChallengeFormDraft extends FormDraft<
	EmailOtpChallengeFormModel,
	EmailOtpChallengeFormModel,
	EmailOtpChallengeFormFields
> {
	protected readonly rules = {
		email: emailPipe,
	}

	constructor() {
		super({ email: '' })
	}

	protected model = (): EmailOtpChallengeFormModel => ({ email: this.email })

	protected load = (entity: EmailOtpChallengeFormModel): void => {
		this.email = entity.email
	}
}

export class EmailOtpVerificationFormDraft extends FormDraft<
	EmailOtpVerificationFormModel,
	EmailOtpVerificationFormModel,
	EmailOtpVerificationFormFields
> {
	protected readonly rules = {
		email: emailPipe,
		code: emailOtpCodePipe,
	}

	constructor() {
		super({ email: '', code: '' })
	}

	protected model = (): EmailOtpVerificationFormModel => ({ email: this.email, code: this.code })

	protected load = (entity: EmailOtpVerificationFormModel): void => {
		this.email = entity.email
		this.code = entity.code
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('EmailOtpChallengeFormDraft', () => {
		it('trims and models valid email input', () => {
			const factory = new EmailOtpChallengeFormDraft()

			factory.email = '  person@example.com  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ email: 'person@example.com' })
		})

		it('rejects invalid email input', () => {
			const factory = new EmailOtpChallengeFormDraft()

			factory.email = 'not-an-email'

			expect(factory.valid).toBe(false)
			expect(factory.errors.email).toBe('Enter a valid email address')
		})
	})

	describe('EmailOtpVerificationFormDraft', () => {
		it('models valid email and OTP code input', () => {
			const factory = new EmailOtpVerificationFormDraft()

			factory.email = 'person@example.com'
			factory.code = ' 123456 '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ email: 'person@example.com', code: '123456' })
		})

		it('rejects empty or non-six-digit OTP code input', () => {
			const factory = new EmailOtpVerificationFormDraft()

			factory.email = 'person@example.com'
			factory.code = '123'

			expect(factory.valid).toBe(false)
			expect(factory.errors.code).toBe('Enter the six-digit code')
		})
	})
}
