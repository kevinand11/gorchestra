<template>
	<main class="shell">
		<section class="hero">
			<p class="eyebrow">Workspace and Portfolio</p>
			<h1>Select the Portfolio you want to use.</h1>
			<p>Selection is explicit and revalidated by the Server API before Portfolio-scoped work.</p>
		</section>

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
				<button type="submit" :disabled="isProvisioningWorkspace">Create Workspace and select Default Portfolio</button>
				<p v-if="provisionWorkspaceError" class="error">{{ provisionWorkspaceError }}</p>
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
						:disabled="isSelectingPortfolio"
						@click="selectPortfolio(access.workspace.id, access.portfolio.id)">
						{{ isSelectingThisPortfolio(access.workspace.id, access.portfolio.id) ? 'Selecting…' : 'Select' }}
					</button>
					<p v-if="portfolioSelectionError(access.workspace.id, access.portfolio.id)" class="error">
						{{ portfolioSelectionError(access.workspace.id, access.portfolio.id) }}
					</p>
				</li>
			</ul>

			<div class="actions">
				<div>
					<button
						type="button"
						class="secondary"
						:disabled="isClearingSelection || !selection?.selected"
						@click="clearSelectionAction.execute()">
						Clear selection
					</button>
					<p v-if="clearSelectionError" class="error">{{ clearSelectionError }}</p>
				</div>
				<div>
					<button type="button" class="secondary" :disabled="isLoggingOut" @click="logoutAction.execute()">Sign out</button>
					<p v-if="logoutError" class="error">{{ logoutError }}</p>
				</div>
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
const selectingPortfolioKey = ref('')
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

async function selectPortfolio(workspaceId: string, portfolioId: string): Promise<void> {
	selectingPortfolioKey.value = portfolioActionKey(workspaceId, portfolioId)
	await selectPortfolioAction.execute(workspaceId, portfolioId)
}

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
const isProvisioningWorkspace = provisionWorkspaceAction.isLoading
const provisionWorkspaceError = provisionWorkspaceAction.error
const isSelectingPortfolio = selectPortfolioAction.isLoading
const isClearingSelection = clearSelectionAction.isLoading
const clearSelectionError = clearSelectionAction.error
const isLoggingOut = logoutAction.isLoading
const logoutError = logoutAction.error

function isSelectingThisPortfolio(workspaceId: string, portfolioId: string): boolean {
	return selectPortfolioAction.isLoading.value && selectingPortfolioKey.value === portfolioActionKey(workspaceId, portfolioId)
}

function portfolioSelectionError(workspaceId: string, portfolioId: string): string {
	return selectingPortfolioKey.value === portfolioActionKey(workspaceId, portfolioId) ? selectPortfolioAction.error.value : ''
}

function portfolioActionKey(workspaceId: string, portfolioId: string): string {
	return `${workspaceId}:${portfolioId}`
}
</script>
