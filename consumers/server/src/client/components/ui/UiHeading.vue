<template>
	<component :is="as" :class="sizeClass">
		<slot />
	</component>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		as?: string
		size?: 'hero' | 'section' | 'subsection'
	}>(),
	{ as: 'h2', size: 'section' },
)

const sizeClass = computed(() => {
	const sizes = {
		hero: 'm-0 max-w-[760px] font-display text-sz-hero font-semibold tracking-[-0.01em]',
		section: 'm-0 text-sz-section font-semibold tracking-[-0.01em]',
		subsection: 'm-0 text-sz-subsection font-semibold',
	}
	return sizes[props.size]
})
</script>
