import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type OverlayPromptFormModel = {
	value: string
}

type OverlayPromptFormFields = OverlayPromptFormModel

type OverlayPromptFormDraftOptions = {
	initialValue: string
	required: boolean
	trim: boolean
	requiredMessage: string
}

const defaultRequiredMessage = 'Enter a value.'
const defaultPromptFormDraftOptions: OverlayPromptFormDraftOptions = {
	initialValue: '',
	required: true,
	trim: false,
	requiredMessage: defaultRequiredMessage,
}

export class OverlayPromptFormDraft extends FormDraft<OverlayPromptFormModel, OverlayPromptFormModel, OverlayPromptFormFields> {
	private required = true
	private trim = false
	private requiredMessage = defaultRequiredMessage

	protected readonly rules = {
		value: v.lazy(() => v.string().pipe(v.custom<string>((value) => this.isValidSubmittedValue(value), this.requiredMessage))),
	}

	constructor(options: Partial<OverlayPromptFormDraftOptions> = {}) {
		const resolved = resolvePromptFormDraftOptions(options)
		super({ value: resolved.initialValue })
		this.required = resolved.required
		this.trim = resolved.trim
		this.requiredMessage = resolved.requiredMessage
		this.set('value', this.value)
	}

	get valueError(): string {
		return this.valid ? '' : this.requiredMessage
	}

	protected model = (): OverlayPromptFormModel => ({ value: this.submittedValue(this.value) })

	protected load = (entity: OverlayPromptFormModel): void => {
		this.value = entity.value
	}

	private isValidSubmittedValue(value: string): boolean {
		return !this.required || this.submittedValue(value).length > 0
	}

	private submittedValue(value: string): string {
		return this.trim ? value.trim() : value
	}
}

function resolvePromptFormDraftOptions(options: Partial<OverlayPromptFormDraftOptions>): OverlayPromptFormDraftOptions {
	return { ...defaultPromptFormDraftOptions, ...options }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('OverlayPromptFormDraft', () => {
		it('returns raw prompt values by default', () => {
			const draft = new OverlayPromptFormDraft()

			draft.value = '  Keep spacing  '

			expect(draft.valid).toBe(true)
			expect(draft.toModel()).toEqual({ value: '  Keep spacing  ' })
		})

		it('trims prompt values when requested', () => {
			const draft = new OverlayPromptFormDraft({ trim: true })

			draft.value = '  Trim me  '

			expect(draft.valid).toBe(true)
			expect(draft.toModel()).toEqual({ value: 'Trim me' })
		})

		it('allows empty values when not required', () => {
			const draft = new OverlayPromptFormDraft({ required: false })

			draft.value = ''

			expect(draft.valid).toBe(true)
			expect(draft.toModel()).toEqual({ value: '' })
		})

		it('rejects whitespace-only values when trimming and required', () => {
			const draft = new OverlayPromptFormDraft({ trim: true })

			draft.value = '   '

			expect(draft.valid).toBe(false)
			expect(draft.errors.value).toBe(defaultRequiredMessage)
		})

		it('exposes submit-time required messages for pristine prompts', () => {
			const draft = new OverlayPromptFormDraft({ requiredMessage: 'Enter rejection feedback' })

			expect(draft.valid).toBe(false)
			expect(draft.errors.value).toBe('')
			expect(draft.valueError).toBe('Enter rejection feedback')
		})
	})
}
