<template>
	<input
		v-model="model"
		v-bind="$attrs"
		:aria-invalid="invalid || undefined"
		class="rounded-input border bg-input px-3.5 py-3 text-input-contrast outline-none placeholder:text-dim focus:outline-none"
		:class="invalid ? 'border-error focus:border-error' : 'border-dimmer focus:border-primary'" />
</template>

<script setup lang="ts">
withDefaults(defineProps<{ invalid?: boolean }>(), { invalid: false })

const model = defineModel<string | number>()
</script>
