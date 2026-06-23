<template>
	<span class="grid shrink-0 place-items-center rounded-full border border-dimmer bg-canvas text-body" :style="containerStyle">
		<svg :width="markSize" :height="markSize" viewBox="0 0 164 164" fill="none" aria-hidden="true">
			<g transform="translate(10 -10)">
				<path
					d="M108 44C99 34 86 29 72 31C45 34 27 55 31 82C35 108 58 124 84 116C106 110 118 91 113 69C110 57 104 49 94 43"
					stroke="currentColor"
					stroke-width="12"
					stroke-linecap="round" />
				<path
					d="M94 30L110 44L96 60"
					stroke="var(--color-primary)"
					stroke-width="12"
					stroke-linecap="round"
					stroke-linejoin="round" />
				<path
					d="M105 105C113 120 108 139 92 148C78 156 57 151 48 137"
					stroke="currentColor"
					stroke-width="12"
					stroke-linecap="round" />
				<path
					d="M64 138L47 137L53 153"
					stroke="var(--color-primary)"
					stroke-width="12"
					stroke-linecap="round"
					stroke-linejoin="round" />
			</g>
		</svg>
	</span>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ size?: number }>(), { size: 26 })

const markSize = computed(() => Math.round(props.size * 0.69))
const containerStyle = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
</script>
