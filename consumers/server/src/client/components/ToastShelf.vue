<template>
	<TransitionGroup
		name="toast"
		tag="section"
		class="pointer-events-none fixed right-4 top-4 z-50 grid w-[min(420px,calc(100vw-32px))] gap-3"
		aria-live="polite"
		aria-label="Notifications">
		<article
			v-for="toast in toastMessages"
			:key="toast.id"
			class="pointer-events-auto rounded-card border bg-card p-4 text-card-contrast shadow-panel"
			:class="kindClass(toast.kind)"
			:role="toast.kind === 'error' ? 'alert' : 'status'">
			<div class="flex items-start justify-between gap-3">
				<div class="grid gap-1">
					<UiHeading as="h2" size="subsection">{{ toast.title }}</UiHeading>
					<UiText v-if="toast.body" tone="muted" size="helper">{{ toast.body }}</UiText>
				</div>
				<button
					type="button"
					class="rounded-pill px-2 text-dim transition hover:text-current"
					:aria-label="`Dismiss notification: ${toast.title}`"
					@click="dismiss(toast.id)">
					×
				</button>
			</div>
		</article>
	</TransitionGroup>
</template>

<script setup lang="ts">
import UiHeading from './ui/UiHeading.vue'
import UiText from './ui/UiText.vue'
import { useToasts, type ToastKind } from '../composables/toasts'

const { toasts: toastMessages, dismiss } = useToasts()

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
