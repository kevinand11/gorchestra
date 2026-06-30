<template>
	<form class="grid gap-3" @submit.prevent="$emit('submit')">
		<label class="grid gap-1.5 font-semibold" :for="titleId">
			{{ titleLabel }}
			<UiInput :id="titleId" v-model="draft.title" required :placeholder="titlePlaceholder" :invalid="!!draft.errors.title" />
		</label>
		<UiText v-if="draft.errors.title" tone="error" size="helper">{{ draft.errors.title }}</UiText>

		<label class="grid gap-1.5 font-semibold" :for="bodyId">
			{{ bodyLabel }}
			<textarea
				:id="bodyId"
				v-model="draft.body"
				class="min-h-40 w-full resize-y border bg-input px-2.5 py-2 text-input-contrast outline-none placeholder:text-dim disabled:cursor-not-allowed disabled:bg-secondary disabled:text-dim"
				:class="draft.errors.body ? 'border-error focus:border-error' : 'border-dimmer focus:border-primary'"
				:placeholder="bodyPlaceholder"
				:aria-invalid="draft.errors.body || undefined" />
		</label>
		<UiText v-if="draft.errors.body" tone="error" size="helper">{{ draft.errors.body }}</UiText>

		<div class="flex flex-wrap items-center gap-2">
			<UiButton type="submit" :loading="loading" :disabled="disabled || !draft.valid">
				{{ submitLabel }}
			</UiButton>
			<UiButton v-if="showCancel" type="button" variant="secondary" :disabled="loading" @click="$emit('cancel')">Cancel</UiButton>
		</div>
		<UiText v-if="error" tone="error">{{ error }}</UiText>
		<slot name="helper" />
	</form>
</template>

<script setup lang="ts">
import UiButton from '../ui/UiButton.vue'
import UiInput from '../ui/UiInput.vue'
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
