import { differ, v, type Pipe } from 'valleyed'

import { FormDraft } from './form-draft'

type FormDraftSelectFields<TValue> = { value: TValue }
export type FormDraftSelectOptions<TValue> = {
	initialValue: TValue
	initialOptions?: readonly TValue[]
	pipe: Pipe<unknown, TValue>
}

export type FormDraftMultiSelectOptions<TValue> = {
	initialValue: TValue[]
	initialOptions?: readonly TValue[]
	pipe: Pipe<unknown, TValue[]>
}

type BaseSelectOptions<TOptionValue, TSelectedValue> = {
	initialValue: TSelectedValue
	initialOptions?: readonly TOptionValue[]
	pipe: Pipe<unknown, TSelectedValue>
}

const selectedOptionUnavailableMessage = 'Selected option is unavailable'
const selectedOptionsUnavailableMessage = 'One or more selected options are unavailable'

class SelectOptionMembership<TValue> {
	#options: readonly TValue[] | null

	constructor(private readonly initialOptions: readonly TValue[] | undefined) {
		this.#options = initialOptionsValue(initialOptions)
	}

	set(values: readonly TValue[]): void {
		this.#options = [...values]
	}

	clear(): void {
		this.#options = null
	}

	reset(): void {
		this.#options = initialOptionsValue(this.initialOptions)
	}

	contains(value: TValue): boolean {
		return this.#options === null || this.#options.some((option) => differ.equal(option, value))
	}

	get known(): boolean {
		return this.#options !== null
	}
}

abstract class BaseSelectFormDraft<TOptionValue, TSelectedValue> extends FormDraft<
	TSelectedValue,
	TSelectedValue,
	FormDraftSelectFields<TSelectedValue>
> {
	readonly #membership: SelectOptionMembership<TOptionValue>

	protected readonly rules = {
		value: v.lazy(() => this.valuePipe()),
	}

	protected constructor(
		private readonly options: BaseSelectOptions<TOptionValue, TSelectedValue>,
		private readonly unavailableMessage: string,
	) {
		super({ value: options.initialValue })
		this.#membership = new SelectOptionMembership(options.initialOptions)
	}

	setOptions(values: readonly TOptionValue[]): void {
		this.#membership.set(values)
		this.set('value', this.value)
	}

	clearOptions(): void {
		this.#membership.clear()
		this.set('value', this.value)
	}

	resetOptions(): void {
		this.#membership.reset()
		this.set('value', this.value)
	}

	override get errors(): Record<keyof FormDraftSelectFields<TSelectedValue>, string> {
		return { value: this.immediateOptionError() || super.errors.value }
	}

	protected model = (): TSelectedValue => this.value

	protected load = (entity: TSelectedValue): void => {
		this.value = entity
	}

	protected optionContains(value: TOptionValue): boolean {
		return this.#membership.contains(value)
	}

	protected abstract selectedOptionsAvailable(value: TSelectedValue): boolean

	private valuePipe(): Pipe<unknown, TSelectedValue> {
		return this.options.pipe.pipe(v.custom((value) => this.selectedOptionsAvailable(value), this.unavailableMessage))
	}

	private immediateOptionError(): string {
		if (!this.#membership.known) return ''
		if (!this.selectedOptionsAvailable(this.value) && this.callerPipeAcceptsCurrentValue()) return this.unavailableMessage
		return ''
	}

	private callerPipeAcceptsCurrentValue(): boolean {
		return v.validate(this.options.pipe, this.value).valid
	}
}

export class FormDraftSelect<TValue> extends BaseSelectFormDraft<TValue, TValue> {
	constructor(options: FormDraftSelectOptions<TValue>) {
		super(options, selectedOptionUnavailableMessage)
	}

	protected selectedOptionsAvailable(value: TValue): boolean {
		return this.optionContains(value)
	}
}

export class FormDraftMultiSelect<TValue> extends BaseSelectFormDraft<TValue, TValue[]> {
	constructor(options: FormDraftMultiSelectOptions<TValue>) {
		super(options, selectedOptionsUnavailableMessage)
	}

	protected selectedOptionsAvailable(values: TValue[]): boolean {
		return values.every((value) => this.optionContains(value))
	}
}

function initialOptionsValue<TValue>(initialOptions: readonly TValue[] | undefined): readonly TValue[] | null {
	return initialOptions === undefined ? null : [...initialOptions]
}
