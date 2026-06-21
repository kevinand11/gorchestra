<template>
	<main class="shell">
		<section class="hero">
			<p class="eyebrow">Workspace and Portfolio</p>
			<h1>Select the Portfolio you want to use.</h1>
			<p>Selection is explicit and revalidated by the Server API before Portfolio-scoped work.</p>
		</section>

		<section v-if="message" class="notice">{{ message }}</section>
		<section v-if="errorMessage" class="error">{{ errorMessage }}</section>

		<section v-if="workspacePortfolios.length === 0" class="card">
			<h2>Provision your first Workspace</h2>
			<p>No accessible Workspace and Portfolio is available yet.</p>
			<form class="stack" @submit.prevent="provisionWorkspace">
				<label>
					Workspace display name
					<input v-model="workspaceDisplayName" required placeholder="Delivery Ops" />
				</label>
				<label>
					Portfolio display name
					<input v-model="portfolioDisplayName" required placeholder="Main Portfolio" />
				</label>
				<button type="submit" :disabled="busy">Create Workspace and select Default Portfolio</button>
			</form>
		</section>

		<section v-else class="card">
			<div class="row">
				<div>
					<h2>Available Portfolios</h2>
					<p v-if="selection?.selected" class="success">
						Selected {{ selection.workspace.displayName }} / {{ selection.portfolio.displayName }}
					</p>
					<p v-else class="muted">Selection required: {{ selection?.reason ?? 'not loaded' }}</p>
				</div>
				<NuxtLink v-if="selection?.selected" class="button-link secondary" to="/app">Go to app</NuxtLink>
			</div>

			<ul class="portfolio-list">
				<li v-for="access in workspacePortfolios" :key="`${access.workspace.id}:${access.portfolio.id}`">
					<div>
						<strong>{{ access.workspace.displayName }}</strong>
						<span>{{ access.portfolio.displayName }}</span>
					</div>
					<button type="button" :disabled="busy" @click="selectPortfolio(access.workspace.id, access.portfolio.id)">
						Select
					</button>
				</li>
			</ul>

			<div class="actions">
				<button type="button" class="secondary" :disabled="busy || !selection?.selected" @click="clearSelection">
					Clear selection
				</button>
				<button type="button" class="secondary" :disabled="busy" @click="logout">Sign out</button>
			</div>
		</section>
	</main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { createPageActionRunner } from '../composables/page-action'
import { useSessionStore } from '../stores/session'

definePageMeta({ middleware: ['is-authenticated'] })

const sessionStore = useSessionStore()

const busy = ref(false)
const message = ref('')
const errorMessage = ref('')
const runAction = createPageActionRunner({ busy, errorMessage, getErrorMessage: sessionStore.errorMessage })
const workspaceDisplayName = ref('Delivery Ops')
const portfolioDisplayName = ref('Main Portfolio')
const workspacePortfolios = computed(() => sessionStore.workspacePortfolios)
const selection = computed(() => sessionStore.selection)

onMounted(refreshSelectionPage)

async function refreshSelectionPage(): Promise<void> {
	await runAction(async () => {
		await sessionStore.loadAuthenticatedState()
	})
}

async function provisionWorkspace(): Promise<void> {
	await runAction(async () => {
		await sessionStore.provisionDefaultWorkspace({
			workspaceDisplayName: workspaceDisplayName.value,
			portfolioDisplayName: portfolioDisplayName.value,
		})
		message.value = 'Workspace provisioned and Default Portfolio selected.'
		await navigateTo('/app')
	})
}

async function selectPortfolio(workspaceId: string, portfolioId: string): Promise<void> {
	await runAction(async () => {
		await sessionStore.setSelection(workspaceId, portfolioId)
		message.value = 'Selection updated.'
		await navigateTo('/app')
	})
}

async function clearSelection(): Promise<void> {
	await runAction(async () => {
		await sessionStore.clearSelection()
		message.value = 'Selection cleared.'
	})
}

async function logout(): Promise<void> {
	await runAction(async () => {
		await sessionStore.logout()
		message.value = 'Signed out.'
		await navigateTo('/sign-in')
	})
}
</script>
