<template>
	<button
		v-bind="attrs"
		:type="buttonType"
		:disabled="isDisabled"
		class="inline-flex cursor-pointer items-center justify-center rounded-pill px-5 py-3 font-extrabold no-underline transition disabled:cursor-not-allowed disabled:opacity-50"
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
		primary: 'bg-primary text-primary-contrast hover:brightness-110',
		secondary: 'border border-dimmer bg-secondary text-secondary-contrast hover:brightness-110',
	}
	return variants[props.variant]
})
</script>
