<template>
	<nav class="mb-8 rounded-card border border-dimmer bg-card p-4 shadow-card">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div>
				<UiText as="p" tone="primary" size="helper" class="font-bold uppercase tracking-[0.16em]">Selected Portfolio</UiText>
				<UiText as="p" tone="muted">
					{{ selectedPortfolio.workspace.displayName }} / {{ selectedPortfolio.portfolio.displayName }}
				</UiText>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<NuxtLink
					v-for="link in [
						{ title: 'Projects', path: '/projects' },
						{ title: 'Secrets', path: '/secrets' },
						{ title: 'Change selection', path: '/select' },
					]"
					:key="link.path"
					:to="link.path"
					class="inline-flex items-center justify-center rounded-pill border border-dimmer bg-secondary px-4 py-2.5 font-extrabold text-secondary-contrast no-underline transition hover:border-primary"
					exact-active-class="border-primary text-primary"
					>{{ link.title }}</NuxtLink
				>
				<UiButton type="button" variant="secondary" :loading="isLoggingOut" @click="logout()">Sign out</UiButton>
			</div>
		</div>
		<UiText v-if="logoutError" class="mt-3" tone="error" size="helper">{{ logoutError }}</UiText>
	</nav>
</template>

<script setup lang="ts">
import { useApiAction } from '../composables/action-state'
import { useSelectedPortfolio } from '../composables/selected-portfolio'
import { useSessionStore } from '../stores/session'
import UiButton from './ui/UiButton.vue'
import UiText from './ui/UiText.vue'

const sessionStore = useSessionStore()
const selectedPortfolio = useSelectedPortfolio()

const {
	isLoading: isLoggingOut,
	error: logoutError,
	execute: logout,
} = useApiAction(async () => {
	await sessionStore.logout()
	if (typeof window !== 'undefined') window.location.assign('/sign-in')
	else await navigateTo('/sign-in')
})
</script>
