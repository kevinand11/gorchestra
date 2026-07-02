<template>
	<TransitionGroup
		name="toast"
		tag="section"
		class="pointer-events-none fixed top-4 right-4 z-50 grid w-[min(420px,calc(100vw-32px))] gap-3"
		aria-live="polite"
		aria-label="Notifications">
		<article
			v-for="message in toastMessages"
			:key="message.id"
			class="pointer-events-auto rounded-card border bg-card p-4 text-card-contrast shadow-panel"
			:class="kindClass(message.kind)"
			:role="message.kind === 'error' ? 'alert' : 'status'">
			<div class="flex items-start justify-between gap-3">
				<div class="grid gap-1">
					<UiHeading as="h2" size="subsection">{{ message.title }}</UiHeading>
					<UiText v-if="message.body" tone="muted" size="helper">{{ message.body }}</UiText>
				</div>
				<UiButton
					type="button"
					variant="ghost"
					size="icon"
					:aria-label="`Dismiss notification: ${message.title}`"
					@click="dismiss(message.id)">
					×
				</UiButton>
			</div>
		</article>
	</TransitionGroup>
</template>

<script setup lang="ts">
import { useOverlayShelf } from '../../composables/core/overlay'
import UiButton from '../ui/UiButton.vue'
import UiHeading from '../ui/UiHeading.vue'
import UiText from '../ui/UiText.vue'

type ToastKind = ReturnType<typeof useOverlayShelf>['toast']['messages']['value'][number]['kind']

const { toast } = useOverlayShelf()
const { messages: toastMessages, dismiss } = toast

function kindClass(kind: ToastKind): string {
	const classes = {
		success: 'border-success text-success',
		error: 'border-error text-error',
		info: 'border-info text-info',
	}
	return classes[kind]
}
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active,
.toast-move {
	transition:
		opacity 180ms ease,
		transform 180ms ease;
}

.toast-enter-from,
.toast-leave-to {
	opacity: 0;
	transform: translateY(-8px);
}

.toast-leave-active {
	position: absolute;
}
</style>
