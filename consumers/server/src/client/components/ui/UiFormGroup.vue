<template>
	<div class="grid gap-1.5">
		<div v-if="$slots.label || label || $slots['label-end']" class="flex items-center justify-between gap-3">
			<slot name="label">
				<UiLabel v-if="label" :for="forId">{{ label }}</UiLabel>
			</slot>
			<slot name="label-end" />
		</div>
		<slot :invalid="hasError" :error-id="errorId" />
		<UiText v-if="showError && error" :id="errorId" tone="error" size="helper">
			{{ error }}
		</UiText>
		<slot name="helper" />
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import UiLabel from './UiLabel.vue'
import UiText from './UiText.vue'

const props = withDefaults(
	defineProps<{
		label?: string
		forId?: string
		error?: string | null
		showError?: boolean
	}>(),
	{ label: undefined, forId: undefined, error: null, showError: true },
)

const hasError = computed(() => !!props.error)
const errorId = computed(() => (props.forId === undefined ? undefined : `${props.forId}-error`))
</script>
