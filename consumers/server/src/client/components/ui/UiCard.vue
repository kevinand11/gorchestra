<template>
	<article class="mb-5 rounded-card border p-6 shadow-panel" :class="toneClass">
		<slot />
	</article>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		tone?: 'default' | 'accent' | 'error' | 'notice'
	}>(),
	{ tone: 'default' },
)

const toneClass = computed(() => {
	const tones = {
		default: 'border-dimmer bg-card text-card-contrast',
		accent: 'border-primary bg-card text-card-contrast',
		error: 'border-error bg-card text-error',
		notice: 'border-info bg-card text-info',
	}
	return tones[props.tone]
})
</script>
