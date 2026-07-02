<template>
	<div ref="root" class="relative w-full">
		<button
			v-if="!alwaysOpen"
			v-bind="$attrs"
			ref="trigger"
			type="button"
			role="combobox"
			aria-haspopup="listbox"
			:aria-controls="listboxId"
			:aria-expanded="isExpanded"
			:aria-invalid="invalid || undefined"
			:disabled="disabled"
			class="flex w-full cursor-pointer items-center gap-2 border bg-input px-2.5 py-2 text-left text-input-contrast outline-none disabled:cursor-not-allowed disabled:bg-secondary disabled:text-dim"
			:class="invalid ? 'border-error focus:border-error' : 'border-dimmer focus:border-primary'"
			@click="toggleOptions"
			@keydown="handleTriggerKeydown">
			<span class="min-w-0 flex-1 truncate" :class="selectedSummary ? '' : 'text-dim'">
				{{ selectedSummary || placeholder }}
			</span>
			<span aria-hidden="true" class="text-dim">⌄</span>
		</button>

		<div v-if="isExpanded" :class="optionsPanelClass">
			<input
				ref="searchInput"
				v-model="search"
				type="search"
				role="combobox"
				aria-autocomplete="list"
				:aria-activedescendant="activeOptionId"
				:aria-controls="listboxId"
				:aria-expanded="isExpanded"
				:aria-label="searchPlaceholder"
				:placeholder="searchPlaceholder"
				class="w-full border-0 border-b border-dimmer bg-input px-2.5 py-2 text-input-contrast outline-none placeholder:text-dim focus:border-primary"
				@keydown="handleSearchKeydown" />
			<div :id="listboxId" role="listbox" :aria-multiselectable="multiple || undefined" class="max-h-64 overflow-y-auto py-1">
				<template v-for="(row, index) in filteredRows" :key="row.key">
					<div
						v-if="row.type === 'group'"
						class="px-2.5 pt-2 pb-1 text-sz-micro font-semibold tracking-[0.06em] text-primary uppercase">
						{{ row.label }}
					</div>
					<button
						v-else
						:id="optionId(index)"
						type="button"
						role="option"
						tabindex="-1"
						:aria-selected="isSelected(row.option.value)"
						:disabled="row.option.disabled"
						class="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left text-sz-helper disabled:cursor-not-allowed disabled:text-dim"
						:class="optionClass(row.option, index)"
						@mousedown.prevent
						@mouseenter="setActiveOptionIndex(row, index)"
						@click="selectOption(row.option)">
						<span class="min-w-0 flex-1 truncate">{{ optionLabel(row.option) }}</span>
						<span v-if="isSelected(row.option.value)" aria-hidden="true" class="text-primary">✓</span>
					</button>
				</template>
				<div v-if="filteredRows.length === 0" class="px-2.5 py-2 text-sz-helper text-dim">{{ emptyLabel }}</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts" generic="TValue = string">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

import type { UiSelectOption, UiSelectOptionGroup, UiSelectOptionInput } from './select-options'

defineOptions({ inheritAttrs: false })

type UiSelectGroupRow = {
	type: 'group'
	key: string
	label: string
}

type UiSelectOptionRow<TValue = string> = {
	type: 'option'
	key: string
	groupLabel: string | null
	option: UiSelectOption<TValue>
}

type UiSelectRow<TValue = string> = UiSelectGroupRow | UiSelectOptionRow<TValue>

const props = withDefaults(
	defineProps<{
		options: readonly UiSelectOptionInput<TValue>[]
		placeholder: string
		invalid?: boolean
		disabled?: boolean
		multiple?: boolean
		alwaysOpen?: boolean
		searchPlaceholder?: string
		emptyLabel?: string
	}>(),
	{
		invalid: false,
		disabled: false,
		multiple: false,
		alwaysOpen: false,
		searchPlaceholder: 'Search…',
		emptyLabel: 'No options available',
	},
)

const model = defineModel<TValue | TValue[]>({ required: true })
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const isOpen = ref(false)
const search = ref('')
const activeIndex = ref(-1)
const componentId = useId()
const listboxId = `${componentId}-listbox`

const isExpanded = computed(() => (props.alwaysOpen || isOpen.value) && !props.disabled)
const rows = computed(() => groupedRows(props.options))
const optionRows = computed(() => rows.value.filter(isOptionRow))
const selectedOptions = computed(() =>
	optionRows.value.map((row) => row.option).filter((option) => selectedValues.value.some((value) => sameValue(value, option.value))),
)
const selectedSummary = computed(() => selectedOptions.value.map(optionLabel).join(', '))
const selectedValues = computed<TValue[]>(() => (props.multiple ? multipleSelectedValues() : singleSelectedValue()))
const filteredRows = computed(() => {
	const searchValue = search.value.trim().toLowerCase()
	return searchValue.length === 0 ? rows.value : filteredGroupedRows(props.options, searchValue)
})
const activeOptionId = computed(() => optionId(activeIndex.value))
const optionsPanelClass = computed(() =>
	props.alwaysOpen
		? 'border border-dimmer bg-card text-card-contrast'
		: 'absolute right-0 left-0 z-50 mt-1 border border-dimmer bg-card text-card-contrast shadow-panel',
)
const searchKeyHandlers: Record<string, () => void> = {
	Escape: () => closeOptions({ focusTrigger: true }),
	ArrowDown: () => moveActiveOption(1),
	ArrowUp: () => moveActiveOption(-1),
	Enter: selectActiveOption,
}

watch(filteredRows, () => {
	activeIndex.value = firstEnabledOptionIndex()
})

watch(activeIndex, () => {
	void scrollActiveOptionIntoView()
})

watch(
	() => props.disabled,
	(disabled) => {
		if (disabled) closeOptions()
	},
)

onMounted(() => {
	document.addEventListener('pointerdown', handleDocumentPointerDown)
})

onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', handleDocumentPointerDown)
})

function multipleSelectedValues(): TValue[] {
	return Array.isArray(model.value) ? model.value : []
}

function singleSelectedValue(): TValue[] {
	return Array.isArray(model.value) ? [] : [model.value]
}

function toggleOptions(): void {
	if (isOpen.value) closeOptions()
	else openOptions()
}

async function openOptions(): Promise<void> {
	if (props.disabled) return
	isOpen.value = true
	activeIndex.value = activeSelectedOptionIndex()
	await nextTick()
	searchInput.value?.focus()
}

function closeOptions({ focusTrigger = false }: { focusTrigger?: boolean } = {}): void {
	isOpen.value = false
	search.value = ''
	activeIndex.value = -1
	if (focusTrigger) trigger.value?.focus()
}

function selectOption(option: UiSelectOption<TValue>): void {
	if (option.disabled) return
	if (!props.multiple) {
		model.value = option.value
		closeAfterSelection()
		return
	}

	model.value = isSelected(option.value)
		? selectedValues.value.filter((value) => !sameValue(value, option.value))
		: [...selectedValues.value, option.value]
}

function closeAfterSelection(): void {
	if (!props.alwaysOpen) closeOptions({ focusTrigger: true })
}

function handleTriggerKeydown(event: KeyboardEvent): void {
	if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
	event.preventDefault()
	openOptions()
}

function handleSearchKeydown(event: KeyboardEvent): void {
	const handler = searchKeyHandlers[event.key]
	if (!handler) return
	event.preventDefault()
	handler()
}

function handleDocumentPointerDown(event: PointerEvent): void {
	if (props.alwaysOpen) return
	const target = event.target
	if (!(target instanceof Node)) return
	if (!root.value?.contains(target)) closeOptions()
}

function selectActiveOption(): void {
	const row = filteredRows.value[activeIndex.value]
	if (row?.type === 'option') selectOption(row.option)
}

function moveActiveOption(direction: 1 | -1): void {
	activeIndex.value = nextEnabledOptionIndex(activeIndex.value, direction, filteredRows.value.length)
}

function nextEnabledOptionIndex(startIndex: number, direction: 1 | -1, rowCount: number): number {
	if (rowCount === 0) return -1
	return candidateOptionIndexes(normalizedActiveStart(startIndex, direction), direction, rowCount).find(isEnabledFilteredOption) ?? -1
}

function candidateOptionIndexes(startIndex: number, direction: 1 | -1, optionCount: number): number[] {
	return Array.from({ length: optionCount }, (_, index) => positiveModulo(startIndex + direction * (index + 1), optionCount))
}

function normalizedActiveStart(startIndex: number, direction: 1 | -1): number {
	if (startIndex >= 0) return startIndex
	return direction === 1 ? -1 : 0
}

function positiveModulo(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor
}

function isEnabledFilteredOption(index: number): boolean {
	const row = filteredRows.value[index]
	return row?.type === 'option' && row.option.disabled !== true
}

function activeSelectedOptionIndex(): number {
	const selectedIndex = filteredRows.value.findIndex(isSelectedOptionRow)
	return selectedIndex === -1 ? firstEnabledOptionIndex() : selectedIndex
}

function isSelectedOptionRow(row: UiSelectRow<TValue>): boolean {
	return row.type === 'option' && isSelected(row.option.value) && row.option.disabled !== true
}

function firstEnabledOptionIndex(): number {
	return filteredRows.value.findIndex((row) => row.type === 'option' && row.option.disabled !== true)
}

function setActiveOptionIndex(row: UiSelectRow<TValue>, index: number): void {
	if (row.type === 'option' && row.option.disabled !== true) activeIndex.value = index
}

async function scrollActiveOptionIntoView(): Promise<void> {
	await nextTick()
	const id = activeOptionId.value
	if (!id || typeof document === 'undefined') return
	document.getElementById(id)?.scrollIntoView({ block: 'nearest' })
}

function isSelected(value: TValue): boolean {
	return selectedValues.value.some((selectedValue) => sameValue(selectedValue, value))
}

function sameValue(left: TValue, right: TValue): boolean {
	return Object.is(left, right)
}

function optionId(index: number): string | undefined {
	const row = filteredRows.value[index]
	return row?.type === 'option' ? `${componentId}-option-${index}` : undefined
}

function optionMatchesSearch(option: UiSelectOption<TValue>, searchValue: string): boolean {
	return optionSearchText(option).includes(searchValue)
}

function optionSearchText(option: UiSelectOption<TValue>): string {
	return `${option.label} ${String(option.value)}`.toLowerCase()
}

function optionLabel(option: UiSelectOption<TValue>): string {
	return option.label
}

function optionClass(option: UiSelectOption<TValue>, index: number): string {
	if (option.disabled) return ''
	if (index === activeIndex.value) return 'bg-secondary text-secondary-contrast'
	if (isSelected(option.value)) return 'text-primary'
	return 'hover:bg-secondary hover:text-secondary-contrast'
}

function groupedRows(options: readonly UiSelectOptionInput<TValue>[]): UiSelectRow<TValue>[] {
	return options.flatMap((entry, index) => (isOptionGroup(entry) ? groupRows(entry, index) : [optionRow(entry, null, `option:${index}`)]))
}

function filteredGroupedRows(options: readonly UiSelectOptionInput<TValue>[], searchValue: string): UiSelectRow<TValue>[] {
	return options.flatMap((entry, index) => filteredEntryRows(entry, index, searchValue))
}

function filteredEntryRows(entry: UiSelectOptionInput<TValue>, index: number, searchValue: string): UiSelectRow<TValue>[] {
	if (!isOptionGroup(entry)) return optionMatchesSearch(entry, searchValue) ? [optionRow(entry, null, `option:${index}`)] : []
	return filteredGroupRows(entry, index, searchValue)
}

function filteredGroupRows(group: UiSelectOptionGroup<TValue>, index: number, searchValue: string): UiSelectRow<TValue>[] {
	const groupMatches = group.label.toLowerCase().includes(searchValue)
	const options = groupMatches ? group.options : group.options.filter((option) => optionMatchesSearch(option, searchValue))
	return options.length === 0 ? [] : groupRows({ ...group, options }, index)
}

function groupRows(group: UiSelectOptionGroup<TValue>, index: number): UiSelectRow<TValue>[] {
	return [
		groupRow(group, index),
		...group.options.map((option, optionIndex) => optionRow(option, group.label, `group:${index}:${optionIndex}`)),
	]
}

function groupRow(group: UiSelectOptionGroup<TValue>, index: number): UiSelectGroupRow {
	return { type: 'group', key: `group:${index}`, label: group.label }
}

function optionRow(option: UiSelectOption<TValue>, groupLabel: string | null, key: string): UiSelectOptionRow<TValue> {
	return { type: 'option', key, groupLabel, option }
}

function isOptionGroup(value: UiSelectOptionInput<TValue>): value is UiSelectOptionGroup<TValue> {
	return 'options' in value
}

function isOptionRow(row: UiSelectRow<TValue>): row is UiSelectOptionRow<TValue> {
	return row.type === 'option'
}
</script>
