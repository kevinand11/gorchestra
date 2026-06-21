<template>
	<input
		v-model="model"
		v-bind="$attrs"
		class="rounded-input border border-dimmer bg-input px-3.5 py-3 text-input-contrast outline-none placeholder:text-dim focus:border-primary focus:outline-none" />
</template>

<script setup lang="ts">
const model = defineModel<string | number>()
</script>
