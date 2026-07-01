<template>
	<UiForm @submit.prevent="$emit('submit')">
		<UiFormGroup :label="titleLabel" :for-id="titleId" :error="draft.errors.title">
			<UiInput :id="titleId" v-model="draft.title" required :placeholder="titlePlaceholder" :invalid="!!draft.errors.title" />
		</UiFormGroup>

		<UiFormGroup :label="bodyLabel" :for-id="bodyId" :error="draft.errors.body">
			<UiTextarea :id="bodyId" v-model="draft.body" class="min-h-40" :placeholder="bodyPlaceholder" :invalid="!!draft.errors.body" />
		</UiFormGroup>

		<div class="flex flex-wrap items-center gap-2">
			<UiButton type="submit" :loading="loading" :disabled="disabled || !draft.valid">
				{{ submitLabel }}
			</UiButton>
			<UiButton v-if="showCancel" type="button" variant="secondary" :disabled="loading" @click="$emit('cancel')">Cancel</UiButton>
		</div>
		<UiText v-if="error" tone="error">{{ error }}</UiText>
		<slot name="helper" />
	</UiForm>
</template>

<script setup lang="ts">
import UiButton from '../ui/UiButton.vue'
import UiForm from '../ui/UiForm.vue'
import UiFormGroup from '../ui/UiFormGroup.vue'
import UiInput from '../ui/UiInput.vue'
import UiTextarea from '../ui/UiTextarea.vue'
import UiText from '../ui/UiText.vue'
import type { MemoryCreationFormDraft, MemoryRevisionFormDraft } from '../../forms/memory'

defineEmits<{
	submit: []
	cancel: []
}>()

withDefaults(
	defineProps<{
		draft: MemoryCreationFormDraft | MemoryRevisionFormDraft
		titleId: string
		bodyId: string
		submitLabel: string
		titleLabel?: string
		bodyLabel?: string
		titlePlaceholder?: string
		bodyPlaceholder?: string
		loading?: boolean
		disabled?: boolean
		error?: string
		showCancel?: boolean
	}>(),
	{
		titleLabel: 'Title',
		bodyLabel: 'Body',
		titlePlaceholder: 'Memory title',
		bodyPlaceholder: 'Add details, decisions, or context…',
		loading: false,
		disabled: false,
		error: '',
		showCancel: false,
	},
)
</script>
