<template>
	<UiShell>
		<UiCard>
			<UiText as="p" tone="primary" class="font-bold uppercase tracking-[0.16em]">Gorchestra Server Consumer</UiText>
			<UiHeading as="h1" size="section">Choosing your route…</UiHeading>
			<UiText tone="muted">Checking your Session and selected Portfolio.</UiText>
		</UiCard>
	</UiShell>
</template>

<script setup lang="ts">
import UiCard from '../components/ui/UiCard.vue'
import UiHeading from '../components/ui/UiHeading.vue'
import UiShell from '../components/ui/UiShell.vue'
import UiText from '../components/ui/UiText.vue'
import { useSessionStore } from '../stores/session'

definePageMeta({
	middleware: [
		async () => {
			const sessionStore = useSessionStore()
			return sessionStore
				.loadAuthenticatedState()
				.then(() => sessionStore.homePath)
				.catch(() => '/sign-in')
		},
	],
})
</script>
