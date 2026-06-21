<template>
	<component :is="as" :class="[toneClass, sizeClass]">
		<slot />
	</component>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		as?: string
		tone?: 'default' | 'muted' | 'error' | 'success' | 'info' | 'primary'
		size?: 'body' | 'helper' | 'lede'
	}>(),
	{ as: 'p', tone: 'default', size: 'body' },
)

const toneClass = computed(() => {
	const tones = {
		default: 'text-current',
		muted: 'text-dim',
		error: 'text-error',
		success: 'text-success',
		info: 'text-info',
		primary: 'text-primary',
	}
	return tones[props.tone]
})
const sizeClass = computed(() => {
	const sizes = {
		body: 'text-sz-base',
		helper: 'text-sz-helper',
		lede: 'max-w-[660px] text-sz-lede',
	}
	return sizes[props.size]
})
</script>
