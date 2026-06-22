<template>
	<svg :width="size" :height="size" viewBox="0 0 164 164" fill="none" aria-hidden="true">
		<path
			d="M108 44C99 34 86 29 72 31C45 34 27 55 31 82C35 108 58 124 84 116C106 110 118 91 113 69C110 57 104 49 94 43"
			stroke="currentColor"
			stroke-width="12"
			stroke-linecap="round" />
		<path d="M94 30L110 44L96 60" stroke="var(--color-primary)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
		<path d="M105 105C113 120 108 139 92 148C78 156 57 151 48 137" stroke="currentColor" stroke-width="12" stroke-linecap="round" />
		<path d="M64 138L47 137L53 153" stroke="var(--color-primary)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 18 })
</script>
