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
		hero: 'm-0 max-w-[760px] font-display text-sz-hero font-extrabold tracking-[-0.08em]',
		section: 'm-0 text-sz-section font-bold',
		subsection: 'm-0 text-sz-subsection font-bold',
	}
	return sizes[props.size]
})
</script>
