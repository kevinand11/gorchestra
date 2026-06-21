<template>
	<main class="shell">
		<section class="hero">
			<p class="eyebrow">Workspace and Portfolio</p>
			<h1>Select the Portfolio you want to use.</h1>
			<p>Selection is explicit and revalidated by the Server API before Portfolio-scoped work.</p>
		</section>

		<section v-if="pageError" class="error">{{ pageError }}</section>

		<section v-if="isInitialSelectionLoading" class="card">
			<h2>Loading your Workspaces…</h2>
			<p class="muted">Checking your accessible Workspaces and selected Portfolio.</p>
		</section>

		<section v-else-if="workspacePortfolios.length === 0" class="card">
			<h2>Provision your first Workspace</h2>
			<p>No accessible Workspace and Portfolio is available yet.</p>
			<form class="stack" @submit.prevent="provisionWorkspaceAction.execute()">
				<label>
					Workspace display name
					<input v-model="workspaceDisplayName" required placeholder="Delivery Ops" />
				</label>
				<label>
					Portfolio display name
					<input v-model="portfolioDisplayName" required placeholder="Main Portfolio" />
				</label>
				<button type="submit" :disabled="isUserActionLoading">Create Workspace and select Default Portfolio</button>
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
					<button
						type="button"
						:disabled="isUserActionLoading"
						@click="selectPortfolioAction.execute(access.workspace.id, access.portfolio.id)">
						Select
					</button>
				</li>
			</ul>

			<div class="actions">
				<button
					type="button"
					class="secondary"
					:disabled="isUserActionLoading || !selection?.selected"
					@click="clearSelectionAction.execute()">
					Clear selection
				</button>
				<button type="button" class="secondary" :disabled="isUserActionLoading" @click="logoutAction.execute()">Sign out</button>
			</div>
		</section>
	</main>
</template>

<script setup lang="ts">
import { useApiAction, useFetchAction } from '../composables/action-state'
import { useSessionStore } from '../stores/session'

definePageMeta({ middleware: ['is-authenticated'] })

const sessionStore = useSessionStore()

const workspaceDisplayName = ref('Delivery Ops')
const portfolioDisplayName = ref('Main Portfolio')
const workspacePortfolios = computed(() => sessionStore.workspacePortfolios)
const selection = computed(() => sessionStore.selection)

const refreshSelectionPageAction = useFetchAction(
	async () => {
		await sessionStore.loadAuthenticatedState()
	},
	{ dedupeKey: 'select-page-session-state' },
)

const provisionWorkspaceAction = useApiAction(async () => {
	await sessionStore.provisionDefaultWorkspace({
		workspaceDisplayName: workspaceDisplayName.value,
		portfolioDisplayName: portfolioDisplayName.value,
	})
	await navigateTo('/app')
})

const selectPortfolioAction = useApiAction(async (workspaceId: string, portfolioId: string) => {
	await sessionStore.setSelection(workspaceId, portfolioId)
	await navigateTo('/app')
})

const clearSelectionAction = useApiAction(async () => {
	await sessionStore.clearSelection()
})

const logoutAction = useApiAction(async () => {
	await sessionStore.logout()
	await navigateTo('/sign-in')
})

const isInitialSelectionLoading = computed(
	() => refreshSelectionPageAction.isLoading.value && !refreshSelectionPageAction.hasExecuted.value,
)
const isUserActionLoading = computed(
	() =>
		provisionWorkspaceAction.isLoading.value ||
		selectPortfolioAction.isLoading.value ||
		clearSelectionAction.isLoading.value ||
		logoutAction.isLoading.value,
)
const pageError = computed(() =>
	firstMessage([
		refreshSelectionPageAction.error.value,
		provisionWorkspaceAction.error.value,
		selectPortfolioAction.error.value,
		clearSelectionAction.error.value,
		logoutAction.error.value,
	]),
)

function firstMessage(messages: string[]): string {
	return messages.find(Boolean) ?? ''
}
</script>
