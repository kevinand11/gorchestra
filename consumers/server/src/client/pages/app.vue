<template>
	<main class="shell">
		<section class="hero">
			<p class="eyebrow">Selected Portfolio</p>
			<h1>Ready for Core work.</h1>
			<p>Project, Plan, and Delivery views will land after Core read routes are added.</p>
		</section>

		<section v-if="selection?.selected" class="grid">
			<article class="card accent">
				<h2>{{ selection.workspace.displayName }} / {{ selection.portfolio.displayName }}</h2>
				<p class="muted">Portfolio registry id: {{ selection.portfolio.id }}</p>
				<p class="muted">Core storage namespace: {{ selection.portfolio.coreStorageNamespace }}</p>
			</article>

			<article class="card">
				<h2>Next: Core read boundary</h2>
				<p>
					This app route is selection-aware. It does not expose Project, Plan, Delivery, or Slice data until the Server API adds
					explicit Core query routes.
				</p>
				<div class="actions">
					<NuxtLink class="button-link" to="/select">Change selection</NuxtLink>
					<button type="button" class="secondary" :disabled="isLoggingOut" @click="logoutAction.execute()">Sign out</button>
				</div>
				<p v-if="logoutError" class="error">{{ logoutError }}</p>
			</article>
		</section>

		<section v-else class="card">
			<h2>Checking selection…</h2>
			<p class="muted">The app route requires a selected Workspace and Portfolio.</p>
		</section>
	</main>
</template>

<script setup lang="ts">
import { useApiAction } from '../composables/action-state'
import { useSessionStore } from '../stores/session'

definePageMeta({ middleware: ['has-selection'] })

const sessionStore = useSessionStore()

const selection = computed(() => sessionStore.selection)
const logoutAction = useApiAction(async () => {
	await sessionStore.logout()
	await navigateTo('/sign-in')
})
const isLoggingOut = logoutAction.isLoading
const logoutError = logoutAction.error
</script>
