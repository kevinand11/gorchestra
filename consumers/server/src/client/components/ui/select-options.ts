export type UiSelectOption<TValue = string> = {
	value: TValue
	label: string
	disabled?: boolean
}

export type UiSelectOptionGroup<TValue = string> = {
	label: string
	options: readonly UiSelectOption<TValue>[]
}

export type UiSelectOptionInput<TValue = string> = UiSelectOption<TValue> | UiSelectOptionGroup<TValue>
