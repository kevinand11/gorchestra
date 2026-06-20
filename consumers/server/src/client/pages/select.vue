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
const api = useServerApi()

const busy = ref(false)
const message = ref('')
const errorMessage = ref('')
const workspaceDisplayName = ref('Delivery Ops')
const portfolioDisplayName = ref('Main Portfolio')
const workspacePortfolios = ref<Awaited<ReturnType<typeof api.listWorkspacePortfolios>>['workspacePortfolios']>([])
const selection = ref<Awaited<ReturnType<typeof api.getSelection>> | null>(null)

onMounted(refreshSelectionPage)

async function refreshSelectionPage(): Promise<void> {
	await runAction(async () => {
		workspacePortfolios.value = (await api.listWorkspacePortfolios()).workspacePortfolios
		selection.value = await api.getSelection()
	})
}

async function provisionWorkspace(): Promise<void> {
	await runAction(async () => {
		await api.provisionDefaultWorkspace({
			workspaceDisplayName: workspaceDisplayName.value,
			portfolioDisplayName: portfolioDisplayName.value,
		})
		message.value = 'Workspace provisioned and Default Portfolio selected.'
		await navigateTo('/app')
	})
}

async function selectPortfolio(workspaceId: string, portfolioId: string): Promise<void> {
	await runAction(async () => {
		selection.value = await api.setSelection(workspaceId, portfolioId)
		message.value = 'Selection updated.'
		await navigateTo('/app')
	})
}

async function clearSelection(): Promise<void> {
	await runAction(async () => {
		selection.value = await api.clearSelection()
		message.value = 'Selection cleared.'
	})
}

async function logout(): Promise<void> {
	await runAction(async () => {
		await api.logout()
		workspacePortfolios.value = []
		selection.value = null
		message.value = 'Signed out.'
		await navigateTo('/sign-in')
	})
}

async function runAction(action: () => Promise<void>): Promise<void> {
	busy.value = true
	errorMessage.value = ''
	try {
		await action()
	} catch (error) {
		errorMessage.value = api.errorMessage(error)
	} finally {
		busy.value = false
	}
}
</script>
