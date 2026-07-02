import { differ, v, type Pipe } from 'valleyed'

import { FormDraft } from './form-draft'

type FormDraftSelectFields<TValue> = { value: TValue }
export type FormDraftSelectPipeBuilder<TValue> = (base: Pipe<unknown, TValue>) => Pipe<unknown, TValue>
export type FormDraftSelectOptions<TValue> = {
	initialValue: TValue
	pipe?: FormDraftSelectPipeBuilder<TValue>
}

type FormDraftMultiSelectFields<TValue> = { value: TValue[] }
export type FormDraftMultiSelectPipeBuilder<TValue> = (base: Pipe<unknown, TValue[]>) => Pipe<unknown, TValue[]>
export type FormDraftMultiSelectOptions<TValue> = {
	initialValue: TValue[]
	pipe?: FormDraftMultiSelectPipeBuilder<TValue>
}

const selectedOptionUnavailableMessage = 'Selected option is unavailable'
const selectedOptionsUnavailableMessage = 'One or more selected options are unavailable'

export class FormDraftSelect<TValue> extends FormDraft<TValue, TValue, FormDraftSelectFields<TValue>> {
	#options: readonly TValue[] | null = null

	protected readonly rules = {
		value: v.lazy(() => this.valuePipe()),
	}

	constructor(private readonly options: FormDraftSelectOptions<TValue>) {
		super({ value: options.initialValue })
	}

	setOptions(values: readonly TValue[]): void {
		this.#options = [...values]
		this.set('value', this.value)
	}

	clearOptions(): void {
		this.#options = null
		this.set('value', this.value)
	}

	override get errors(): Record<keyof FormDraftSelectFields<TValue>, string> {
		return { value: this.immediateOptionError() || super.errors.value }
	}

	protected model = (): TValue => this.value

	protected load = (entity: TValue): void => {
		this.value = entity
	}

	private valuePipe(): Pipe<unknown, TValue> {
		const base = v.any<TValue>()
		const customPipe = this.options.pipe?.(base) ?? base
		return customPipe.pipe(v.custom((value) => this.optionContains(value), selectedOptionUnavailableMessage))
	}

	private optionContains(value: TValue): boolean {
		return this.#options === null || this.#options.some((option) => differ.equal(option, value))
	}

	private immediateOptionError(): string {
		if (this.#options === null) return ''
		if (!this.optionContains(this.value) && this.callerPipeAcceptsCurrentValue()) return selectedOptionUnavailableMessage
		return ''
	}

	private callerPipeAcceptsCurrentValue(): boolean {
		const base = v.any<TValue>()
		const customPipe = this.options.pipe?.(base) ?? base
		return v.validate(customPipe, this.value).valid
	}
}

export class FormDraftMultiSelect<TValue> extends FormDraft<TValue[], TValue[], FormDraftMultiSelectFields<TValue>> {
	#options: readonly TValue[] | null = null

	protected readonly rules = {
		value: v.lazy(() => this.valuePipe()),
	}

	constructor(private readonly options: FormDraftMultiSelectOptions<TValue>) {
		super({ value: options.initialValue })
	}

	setOptions(values: readonly TValue[]): void {
		this.#options = [...values]
		this.set('value', this.value)
	}

	clearOptions(): void {
		this.#options = null
		this.set('value', this.value)
	}

	override get errors(): Record<keyof FormDraftMultiSelectFields<TValue>, string> {
		return { value: this.immediateOptionError() || super.errors.value }
	}

	protected model = (): TValue[] => this.value

	protected load = (entity: TValue[]): void => {
		this.value = entity
	}

	private valuePipe(): Pipe<unknown, TValue[]> {
		const base = v.array(v.any<TValue>())
		const customPipe = this.options.pipe?.(base) ?? base
		return customPipe.pipe(v.custom((value) => this.optionsContainAll(value), selectedOptionsUnavailableMessage))
	}

	private optionsContainAll(values: TValue[]): boolean {
		return this.#options === null || values.every((value) => this.optionContains(value))
	}

	private optionContains(value: TValue): boolean {
		return this.#options === null || this.#options.some((option) => differ.equal(option, value))
	}

	private immediateOptionError(): string {
		if (this.#options === null) return ''
		if (!this.optionsContainAll(this.value) && this.callerPipeAcceptsCurrentValue()) return selectedOptionsUnavailableMessage
		return ''
	}

	private callerPipeAcceptsCurrentValue(): boolean {
		const base = v.array(v.any<TValue>())
		const customPipe = this.options.pipe?.(base) ?? base
		return v.validate(customPipe, this.value).valid
	}
}
