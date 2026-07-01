<template>
	<textarea
		v-model="model"
		v-bind="$attrs"
		:aria-invalid="invalid || undefined"
		class="w-full resize-y border bg-input px-2.5 py-2 text-input-contrast outline-none placeholder:text-dim disabled:cursor-not-allowed disabled:bg-secondary disabled:text-dim"
		:class="invalid ? 'border-error focus:border-error' : 'border-dimmer focus:border-primary'" />
</template>

<script setup lang="ts">
withDefaults(defineProps<{ invalid?: boolean }>(), { invalid: false })

const model = defineModel<string>()
</script>
