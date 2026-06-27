<template>
	<button
		v-bind="attrs"
		:type="buttonType"
		:disabled="isDisabled"
		class="inline-flex cursor-pointer items-center justify-center border px-3 py-1.5 text-sz-helper font-semibold transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
		:class="variantClass">
		<slot />
	</button>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		variant?: 'primary' | 'secondary'
		loading?: boolean
	}>(),
	{ variant: 'primary', loading: false },
)
const attrs = useAttrs() as { disabled?: boolean; type?: 'button' | 'submit' | 'reset' }

const buttonType = computed(() => attrs.type ?? 'button')
const isDisabled = computed(() => props.loading || Boolean(attrs.disabled))
const variantClass = computed(() => {
	const variants = {
		primary: 'border-primary bg-primary text-primary-contrast',
		secondary: 'border-dimmer bg-secondary text-secondary-contrast hover:border-dim',
	}
	return variants[props.variant]
})
</script>
