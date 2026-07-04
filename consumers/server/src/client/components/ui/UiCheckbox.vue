<template>
	<label
		class="relative inline-flex max-w-full cursor-pointer items-start gap-2 text-sz-helper disabled:cursor-not-allowed"
		:class="[disabled ? 'cursor-not-allowed opacity-60' : '', reverse ? 'flex-row-reverse' : '']">
		<input class="peer sr-only" type="checkbox" :checked="isSelected" :disabled="disabled" @change="toggle" />
		<span v-if="type === 'checkbox'" aria-hidden="true" :class="checkboxClass">
			<span :class="isSelected ? '' : 'opacity-0'">✓</span>
		</span>
		<span v-else aria-hidden="true" :class="switchTrackClass">
			<span :class="switchKnobClass" />
		</span>
		<span v-if="$slots.default || description" class="min-w-0 flex-1">
			<span v-if="$slots.default" class="block"><slot /></span>
			<span v-if="description" class="mt-0.5 block leading-5 text-dim">{{ description }}</span>
		</span>
	</label>
</template>

<script setup lang="ts" generic="T = boolean">
import { differ } from 'valleyed'
import { computed } from 'vue'

const props = withDefaults(
	defineProps<{
		type?: 'checkbox' | 'switch'
		value?: T
		uncheckedValue?: T
		disabled?: boolean
		description?: string
		reverse?: boolean
	}>(),
	{
		type: 'checkbox',
		disabled: false,
		description: undefined,
		reverse: false,
	},
)

const model = defineModel<T | T[]>({ required: true })
const checkedValue = computed<T>(() => props.value ?? (true as T))
const uncheckedValue = computed<T>(() => props.uncheckedValue ?? (false as T))
const isSelected = computed(() =>
	Array.isArray(model.value) ? arrayIncludes(model.value, checkedValue.value) : differ.equal(model.value, checkedValue.value),
)
const checkboxClass = computed(() => [
	'mt-0.5 flex size-4 shrink-0 items-center justify-center border text-[10px] font-semibold leading-none transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary',
	isSelected.value ? 'border-primary bg-primary text-primary-contrast' : 'border-dimmer bg-input text-transparent',
])
const switchTrackClass = computed(() => [
	'mt-0.5 flex h-5 w-9 shrink-0 items-center border p-0.5 transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary',
	isSelected.value ? 'border-primary bg-primary' : 'border-dimmer bg-input',
])
const switchKnobClass = computed(() => [
	'block size-3 bg-current transition-transform',
	isSelected.value ? 'translate-x-4 text-primary-contrast' : 'translate-x-0 text-dim',
])

function toggle(): void {
	if (props.disabled) return
	model.value = Array.isArray(model.value) ? toggledArray(model.value) : toggledScalar()
}

function toggledScalar(): T {
	return isSelected.value ? uncheckedValue.value : checkedValue.value
}

function toggledArray(values: T[]): T[] {
	return isSelected.value ? values.filter((value) => !differ.equal(value, checkedValue.value)) : [...values, checkedValue.value]
}

function arrayIncludes(values: T[], value: T): boolean {
	return values.some((entry) => differ.equal(entry, value))
}
</script>
