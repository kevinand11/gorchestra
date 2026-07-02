<template>
	<button
		v-bind="attrs"
		:type="buttonType"
		:disabled="isDisabled"
		class="inline-flex cursor-pointer items-center justify-center border font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
		:class="[variantClass, sizeClass]">
		<slot />
	</button>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		variant?: 'primary' | 'secondary' | 'ghost'
		tone?: 'default' | 'danger'
		size?: 'default' | 'icon'
		loading?: boolean
	}>(),
	{ variant: 'primary', tone: 'default', size: 'default', loading: false },
)
const attrs = useAttrs() as { disabled?: boolean; type?: 'button' | 'submit' | 'reset' }

const buttonType = computed(() => attrs.type ?? 'button')
const isDisabled = computed(() => props.loading || Boolean(attrs.disabled))
const variantClass = computed(() => {
	const defaultVariants = {
		primary: 'border-primary bg-primary text-primary-contrast hover:brightness-110',
		secondary: 'border-dimmer bg-secondary text-secondary-contrast hover:border-dim hover:brightness-110',
		ghost: 'border-transparent bg-transparent text-dim hover:text-current',
	}
	const dangerVariants = {
		primary: 'border-error bg-error text-error-contrast hover:brightness-110',
		secondary: 'border-error bg-secondary text-error hover:brightness-110',
		ghost: 'border-transparent bg-transparent text-error hover:brightness-110',
	}
	return props.tone === 'danger' ? dangerVariants[props.variant] : defaultVariants[props.variant]
})
const sizeClass = computed(() => {
	const sizes = {
		default: 'px-3 py-1.5 text-sz-helper',
		icon: 'size-7 text-sz-subsection leading-none',
	}
	return sizes[props.size]
})
</script>
