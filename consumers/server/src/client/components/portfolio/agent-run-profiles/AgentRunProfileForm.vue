<template>
	<UiForm @submit.prevent="emit('submit')">
		<div class="grid gap-3 md:grid-cols-3">
			<UiFormGroup label="Name" for-id="agent-run-profile-name" :error="form.errors.name">
				<UiInput id="agent-run-profile-name" v-model="form.name" :invalid="!!form.errors.name" />
			</UiFormGroup>
			<UiFormGroup label="Model" for-id="agent-run-profile-model" :error="form.modelUse.errors.modelId">
				<UiSelect
					id="agent-run-profile-model"
					v-model="form.modelUse.modelId.value"
					:options="modelSelect.modelOptions.value"
					placeholder="Select Model"
					:invalid="!!form.modelUse.errors.modelId" />
			</UiFormGroup>
			<UiFormGroup label="Thinking" for-id="agent-run-profile-thinking" :error="form.modelUse.errors.thinkingLevel">
				<UiSelect
					id="agent-run-profile-thinking"
					v-model="form.modelUse.thinkingLevel.value"
					:options="modelSelect.thinkingLevelOptions.value"
					placeholder="Select thinking"
					:invalid="!!form.modelUse.errors.thinkingLevel" />
			</UiFormGroup>
		</div>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<UiButton type="submit" :loading="loading" :disabled="disabled">{{ submitLabel }}</UiButton>
			<UiText v-if="error" tone="error">{{ error }}</UiText>
		</div>
	</UiForm>
</template>

<script setup lang="ts">
import UiButton from '../../ui/UiButton.vue'
import UiForm from '../../ui/UiForm.vue'
import UiFormGroup from '../../ui/UiFormGroup.vue'
import UiInput from '../../ui/UiInput.vue'
import UiSelect from '../../ui/UiSelect.vue'
import UiText from '../../ui/UiText.vue'
import type { useSelectModel } from '../../../composables/portfolio/models/select-model'
import type { AgentRunProfileFormDraft } from '../../../forms/agent-run-profile'

defineProps<{
	form: AgentRunProfileFormDraft
	modelSelect: ReturnType<typeof useSelectModel>
	submitLabel: string
	loading: boolean
	disabled: boolean
	error: string
}>()

const emit = defineEmits<{ submit: [] }>()
</script>
