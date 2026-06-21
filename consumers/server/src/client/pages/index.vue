<template>
	<main class="shell">
		<section class="card">
			<p class="eyebrow">Gorchestra Server Consumer</p>
			<h1>Choosing your route…</h1>
			<p class="muted">Checking your Session and selected Portfolio.</p>
		</section>
	</main>
</template>

<script setup lang="ts">
import { useSessionStore } from '../stores/session'

definePageMeta({
	middleware: [
		async () => {
			const sessionStore = useSessionStore()
			try {
				await sessionStore.loadAuthenticatedState()
				return sessionStore.homePath
			} catch {
				return '/sign-in'
			}
		},
	],
})
</script>
