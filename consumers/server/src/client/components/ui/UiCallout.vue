<template>
	<div class="border-l-2 py-2 pl-3 text-sz-helper leading-5" :class="toneClass">
		<slot />
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
	defineProps<{
		tone?: 'accent' | 'error' | 'notice' | 'success'
	}>(),
	{ tone: 'accent' },
)

const toneClass = computed(() => {
	const tones = {
		accent: 'border-primary text-card-contrast',
		error: 'border-error text-error',
		notice: 'border-info text-card-contrast',
		success: 'border-success text-card-contrast',
	}
	return tones[props.tone]
})
</script>
