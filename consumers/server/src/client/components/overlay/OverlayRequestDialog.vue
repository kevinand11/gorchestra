<template>
	<dialog
		ref="dialog"
		class="m-0 h-dvh max-h-none w-dvw max-w-none border-0 bg-transparent p-4 text-body outline-none"
		aria-modal="true"
		@click="handleBackdropClick"
		@cancel="handleCancel">
		<OverlayToastStack v-if="isTop" />
		<section class="w-[min(520px,calc(100vw-32px))] border border-dimmer bg-card text-card-contrast shadow-panel">
			<header class="border-b border-dimmer px-4 py-3">
				<UiHeading as="h2" size="subsection">{{ request.title }}</UiHeading>
				<UiText v-if="request.body" class="m-0 mt-1 whitespace-pre-line" tone="muted" size="helper">{{ request.body }}</UiText>
			</header>

			<template v-if="request.type === 'confirm'">
				<footer class="flex justify-end gap-2 px-4 py-3">
					<UiButton
						type="button"
						:data-overlay-initial-focus="true"
						:variant="request.cancel.variant"
						:tone="request.cancel.tone"
						@click="resolveRequest(request.id, false)">
						{{ request.cancel.label }}
					</UiButton>
					<UiButton
						type="button"
						:variant="request.confirm.variant"
						:tone="request.confirm.tone"
						@click="resolveRequest(request.id, true)">
						{{ request.confirm.label }}
					</UiButton>
				</footer>
			</template>

			<UiForm v-else class="grid gap-0" @submit.prevent="submitPrompt()">
				<section class="border-b border-dimmer px-4 py-3">
					<UiFormGroup :label="request.input.label" :for-id="promptInputId" :error="promptValueError">
						<UiTextarea
							v-if="request.input.type === 'textarea'"
							:id="promptInputId"
							v-model="promptForm.value"
							:data-overlay-initial-focus="true"
							:placeholder="request.input.placeholder"
							:rows="request.input.rows"
							:invalid="!!promptValueError" />
						<UiInput
							v-else
							:id="promptInputId"
							v-model="promptForm.value"
							:data-overlay-initial-focus="true"
							:placeholder="request.input.placeholder"
							:invalid="!!promptValueError" />
					</UiFormGroup>
				</section>
				<footer class="flex justify-end gap-2 px-4 py-3">
					<UiButton
						type="button"
						:variant="request.cancel.variant"
						:tone="request.cancel.tone"
						@click="resolveRequest(request.id, null)">
						{{ request.cancel.label }}
					</UiButton>
					<UiButton type="submit" :variant="request.confirm.variant" :tone="request.confirm.tone">
						{{ request.confirm.label }}
					</UiButton>
				</footer>
			</UiForm>
		</section>
	</dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

import { useOverlayShelf } from '../../composables/core/overlay'
import { OverlayPromptFormDraft } from '../../forms/overlay'
import UiButton from '../ui/UiButton.vue'
import UiForm from '../ui/UiForm.vue'
import UiFormGroup from '../ui/UiFormGroup.vue'
import UiHeading from '../ui/UiHeading.vue'
import UiInput from '../ui/UiInput.vue'
import UiText from '../ui/UiText.vue'
import UiTextarea from '../ui/UiTextarea.vue'
import OverlayToastStack from './OverlayToastStack.vue'

type OverlayRequest = ReturnType<typeof useOverlayShelf>['requests']['value'][number]

const props = defineProps<{
	request: OverlayRequest
	isTop: boolean
}>()

const { resolveRequest } = useOverlayShelf()
const dialog = ref<HTMLDialogElement | null>(null)
const promptSubmitAttempted = ref(false)
const promptInputId = `overlay-prompt-${props.request.id}`
const promptForm =
	props.request.type === 'prompt'
		? new OverlayPromptFormDraft({
				initialValue: props.request.input.initialValue,
				required: props.request.input.required,
				trim: props.request.input.trim,
				requiredMessage: props.request.input.requiredMessage,
			})
		: new OverlayPromptFormDraft({ required: false })

const promptValueError = computed(() => promptForm.errors.value || (promptSubmitAttempted.value ? promptForm.valueError : ''))

onMounted(() => {
	const element = dialog.value
	if (element !== null && !element.open) element.showModal()
	void nextTick(() => focusInitialControl())
})

function submitPrompt(): void {
	if (props.request.type !== 'prompt') return
	promptSubmitAttempted.value = true
	if (!promptForm.valid) return
	resolveRequest(props.request.id, promptForm.toModel().value)
}

function handleCancel(event: Event): void {
	event.preventDefault()
	cancelTopRequest()
}

function handleBackdropClick(event: MouseEvent): void {
	if (event.target !== event.currentTarget) return
	cancelTopRequest()
}

function cancelTopRequest(): void {
	if (!props.isTop || !props.request.dismissible) return
	resolveRequest(props.request.id, props.request.type === 'confirm' ? false : null)
}

function focusInitialControl(): void {
	dialog.value?.querySelector<HTMLElement>('[data-overlay-initial-focus="true"]')?.focus()
}
</script>

<style scoped>
dialog[open] {
	display: grid;
	place-items: center;
}

dialog::backdrop {
	background: rgb(0 0 0 / 48%);
}
</style>
