<template>
	<NuxtLayout name="default" topbar-subtitle="Checking your Session and selected Portfolio.">
		<section class="border-b border-dimmer px-3 py-3">
			<p class="m-0 text-sz-helper font-semibold uppercase tracking-[0.16em] text-primary">Gorchestra Server Consumer</p>
			<h1 class="m-0 mt-2 text-sz-section font-semibold tracking-[-0.01em]">Choosing your route…</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Checking your Session and selected Portfolio.</p>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
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
