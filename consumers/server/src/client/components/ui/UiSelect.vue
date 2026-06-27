<template>
	<div ref="root" class="relative w-full">
		<button
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

		<div
			v-if="isOpen && !disabled"
			class="absolute right-0 left-0 z-50 mt-1 border border-dimmer bg-card text-card-contrast shadow-panel">
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
				<button
					v-for="(option, index) in filteredOptions"
					:id="optionId(index)"
					:key="option.value"
					type="button"
					role="option"
					tabindex="-1"
					:aria-selected="isSelected(option.value)"
					:disabled="option.disabled"
					class="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left text-sz-helper disabled:cursor-not-allowed disabled:text-dim"
					:class="optionClass(option, index)"
					@mousedown.prevent
					@mouseenter="activeIndex = index"
					@click="selectOption(option)">
					<span class="min-w-0 flex-1 truncate">{{ optionLabel(option) }}</span>
					<span v-if="isSelected(option.value)" aria-hidden="true" class="text-primary">✓</span>
				</button>
				<div v-if="filteredOptions.length === 0" class="px-2.5 py-2 text-sz-helper text-dim">{{ emptyLabel }}</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts" generic="TValue extends string = string">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

defineOptions({ inheritAttrs: false })

type UiSelectOption<TValue extends string = string> = {
	value: TValue
	label: string
	disabled?: boolean
}

const props = withDefaults(
	defineProps<{
		options: readonly UiSelectOption<TValue>[]
		placeholder: string
		invalid?: boolean
		disabled?: boolean
		multiple?: boolean
		searchPlaceholder?: string
		emptyLabel?: string
	}>(),
	{
		invalid: false,
		disabled: false,
		multiple: false,
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

const isExpanded = computed(() => isOpen.value && !props.disabled)
const selectedOptions = computed(() => props.options.filter((option) => selectedValues.value.includes(option.value)))
const selectedSummary = computed(() => selectedOptions.value.map(optionLabel).join(', '))
const selectedValues = computed<TValue[]>(() => (props.multiple ? multipleSelectedValues() : singleSelectedValue()))
const filteredOptions = computed(() => {
	const searchValue = search.value.trim().toLowerCase()
	if (searchValue.length === 0) return props.options
	return props.options.filter((option) => optionMatchesSearch(option, searchValue))
})
const activeOptionId = computed(() => optionId(activeIndex.value))
const searchKeyHandlers: Record<string, () => void> = {
	Escape: () => closeOptions({ focusTrigger: true }),
	ArrowDown: () => moveActiveOption(1),
	ArrowUp: () => moveActiveOption(-1),
	Enter: selectActiveOption,
}

watch(filteredOptions, () => {
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
	return isNonEmptySelectedValue(model.value) ? [model.value] : []
}

function isNonEmptySelectedValue(value: TValue | TValue[]): value is TValue {
	return typeof value === 'string' && value.length > 0
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
		closeOptions({ focusTrigger: true })
		return
	}

	model.value = isSelected(option.value)
		? selectedValues.value.filter((value) => value !== option.value)
		: [...selectedValues.value, option.value]
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
	const target = event.target
	if (!(target instanceof Node)) return
	if (!root.value?.contains(target)) closeOptions()
}

function selectActiveOption(): void {
	const option = filteredOptions.value[activeIndex.value]
	if (option) selectOption(option)
}

function moveActiveOption(direction: 1 | -1): void {
	activeIndex.value = nextEnabledOptionIndex(activeIndex.value, direction, filteredOptions.value.length)
}

function nextEnabledOptionIndex(startIndex: number, direction: 1 | -1, optionCount: number): number {
	if (optionCount === 0) return -1
	return candidateOptionIndexes(normalizedActiveStart(startIndex, direction), direction, optionCount).find(isEnabledFilteredOption) ?? -1
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
	return !filteredOptions.value[index]?.disabled
}

function activeSelectedOptionIndex(): number {
	const selectedIndex = filteredOptions.value.findIndex((option) => isSelected(option.value) && !option.disabled)
	return selectedIndex === -1 ? firstEnabledOptionIndex() : selectedIndex
}

function firstEnabledOptionIndex(): number {
	return filteredOptions.value.findIndex((option) => !option.disabled)
}

async function scrollActiveOptionIntoView(): Promise<void> {
	await nextTick()
	const id = activeOptionId.value
	if (!id || typeof document === 'undefined') return
	document.getElementById(id)?.scrollIntoView({ block: 'nearest' })
}

function isSelected(value: TValue): boolean {
	return selectedValues.value.includes(value)
}

function optionId(index: number): string | undefined {
	return index >= 0 ? `${componentId}-option-${index}` : undefined
}

function optionMatchesSearch(option: UiSelectOption<TValue>, searchValue: string): boolean {
	return option.value.toLowerCase().includes(searchValue) || option.label.toLowerCase().includes(searchValue)
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
</script>
