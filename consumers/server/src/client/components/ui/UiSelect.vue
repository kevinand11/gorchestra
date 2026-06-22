<template>
	<select
		v-model="model"
		v-bind="$attrs"
		:aria-invalid="invalid || undefined"
		class="rounded-input border bg-input px-3.5 py-3 text-input-contrast outline-none focus:outline-none"
		:class="invalid ? 'border-error focus:border-error' : 'border-dimmer focus:border-primary'">
		<slot />
	</select>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ invalid?: boolean }>(), { invalid: false })

const model = defineModel<string>()
</script>
