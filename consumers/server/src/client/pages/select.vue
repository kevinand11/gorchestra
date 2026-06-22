<template>
	<UiShell>
		<UiHero>
			<UiText as="p" tone="primary" class="font-bold uppercase tracking-[0.16em]">Workspace and Portfolio</UiText>
			<UiHeading as="h1" size="hero">Select the Portfolio you want to use.</UiHeading>
			<UiText size="lede" tone="muted">Selection is explicit and revalidated by the Server API before Portfolio-scoped work.</UiText>
		</UiHero>

		<UiCard v-if="isLoadingWorkspacePortfolios && !hasLoadedWorkspacePortfolios">
			<UiHeading as="h2" size="section">Loading your Workspaces…</UiHeading>
			<UiText tone="muted">Checking your accessible Workspaces and selected Portfolio.</UiText>
		</UiCard>

		<UiCard v-else-if="workspacePortfoliosError">
			<UiHeading as="h2" size="section">Could not load Workspaces.</UiHeading>
			<UiText tone="error">{{ workspacePortfoliosError }}</UiText>
		</UiCard>

		<UiCard v-else-if="workspacePortfolios.length === 0">
			<UiHeading as="h2" size="section" class="mb-2">Provision your first Workspace</UiHeading>
			<UiText tone="muted">No accessible Workspace and Portfolio is available yet.</UiText>
			<form class="mt-4 grid max-w-[520px] gap-4" @submit.prevent="provisionWorkspace()">
				<label class="grid gap-2 font-bold text-dim">
					Workspace display name
					<UiInput
						v-model="provisionWorkspaceForm.workspaceDisplayName"
						required
						placeholder="Delivery Ops"
						:invalid="!!provisionWorkspaceForm.errors.workspaceDisplayName" />
				</label>
				<UiText v-if="provisionWorkspaceForm.errors.workspaceDisplayName" tone="error" size="helper">
					{{ provisionWorkspaceForm.errors.workspaceDisplayName }}
				</UiText>
				<label class="grid gap-2 font-bold text-dim">
					Portfolio display name
					<UiInput
						v-model="provisionWorkspaceForm.portfolioDisplayName"
						required
						placeholder="Main Portfolio"
						:invalid="!!provisionWorkspaceForm.errors.portfolioDisplayName" />
				</label>
				<UiText v-if="provisionWorkspaceForm.errors.portfolioDisplayName" tone="error" size="helper">
					{{ provisionWorkspaceForm.errors.portfolioDisplayName }}
				</UiText>
				<UiButton type="submit" :loading="isProvisioningWorkspace" :disabled="!provisionWorkspaceForm.valid">
					Create Workspace and select Default Portfolio
				</UiButton>
				<UiText v-if="provisionWorkspaceError" tone="error">{{ provisionWorkspaceError }}</UiText>
			</form>
		</UiCard>

		<UiCard v-else>
			<div class="flex items-center justify-between gap-4">
				<div>
					<UiHeading as="h2" size="section">Available Portfolios</UiHeading>
					<UiText v-if="isLoadingWorkspacePortfolios && hasLoadedWorkspacePortfolios" tone="muted" size="helper">
						Refreshing available Portfolios…
					</UiText>
					<UiText v-if="selection?.selected" tone="success">
						Selected {{ selection.workspace.displayName }} / {{ selection.portfolio.displayName }}
					</UiText>
					<UiText v-else tone="muted">Selection required: {{ selection?.reason ?? 'not loaded' }}</UiText>
				</div>
				<NuxtLink
					v-if="selection?.selected"
					class="inline-flex items-center justify-center rounded-pill border border-dimmer bg-secondary px-5 py-3 font-extrabold text-secondary-contrast no-underline transition hover:brightness-110"
					to="/projects">
					Go to Projects
				</NuxtLink>
			</div>

			<ul class="mt-6 grid list-none gap-3 p-0">
				<li
					v-for="access in workspacePortfolios"
					:key="`${access.workspace.id}:${access.portfolio.id}`"
					class="flex items-center justify-between gap-3 rounded-list-item border border-dimmer bg-dimmer p-3.5">
					<div>
						<strong>{{ access.workspace.displayName }}</strong>
						<UiText as="span" tone="muted">{{ access.portfolio.displayName }}</UiText>
					</div>
					<div class="grid justify-items-end gap-2">
						<UiButton
							type="button"
							:disabled="isSelectingPortfolio"
							:loading="isSelectingThisPortfolio(access.workspace.id, access.portfolio.id)"
							@click="selectPortfolio(access.workspace.id, access.portfolio.id)">
							{{ isSelectingThisPortfolio(access.workspace.id, access.portfolio.id) ? 'Selecting…' : 'Select' }}
						</UiButton>
						<UiText v-if="portfolioSelectionError(access.workspace.id, access.portfolio.id)" tone="error" size="helper">
							{{ portfolioSelectionError(access.workspace.id, access.portfolio.id) }}
						</UiText>
					</div>
				</li>
			</ul>

			<div class="mt-6 flex flex-wrap items-start gap-3">
				<div class="grid gap-2">
					<UiButton
						type="button"
						variant="secondary"
						:loading="isClearingSelection"
						:disabled="!selection?.selected"
						@click="clearSelection()">
						Clear selection
					</UiButton>
					<UiText v-if="clearSelectionError" tone="error">{{ clearSelectionError }}</UiText>
				</div>
				<div class="grid gap-2">
					<UiButton type="button" variant="secondary" :loading="isLoggingOut" @click="logout()">Sign out</UiButton>
					<UiText v-if="logoutError" tone="error">{{ logoutError }}</UiText>
				</div>
			</div>
		</UiCard>
	</UiShell>
</template>

<script setup lang="ts">
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiHeading from '../components/ui/UiHeading.vue'
import UiHero from '../components/ui/UiHero.vue'
import UiInput from '../components/ui/UiInput.vue'
import UiShell from '../components/ui/UiShell.vue'
import UiText from '../components/ui/UiText.vue'
import { useApiAction, useFetchAction } from '../composables/action-state'
import { useQueryCache } from '../composables/query-cache'
import { useServerApi, type ServerApi } from '../composables/useServerApi'
import { ProvisionWorkspaceFormFactory } from '../forms/workspace'
import { useSessionStore } from '../stores/session'
import { useToastStore } from '../stores/toasts'

definePageMeta({ middleware: ['is-authenticated'] })

type WorkspacePortfolios = Awaited<ReturnType<ServerApi['listWorkspacePortfolios']>>

const sessionStore = useSessionStore()
const toastStore = useToastStore()
const serverApi = useServerApi()
const queryCache = useQueryCache()
const { queryKeys } = queryCache

const provisionWorkspaceForm = new ProvisionWorkspaceFormFactory()
const selectingPortfolioKey = ref('')
const selection = computed(() => sessionStore.selection)

const {
	data: workspacePortfolios,
	isLoading: isLoadingWorkspacePortfolios,
	error: workspacePortfoliosError,
	hasExecuted: hasLoadedWorkspacePortfolios,
} = useFetchAction(() => serverApi.listWorkspacePortfolios(), {
	queryKey: queryKeys.workspacePortfolios(),
	initialData: [] as WorkspacePortfolios,
})

const {
	isLoading: isProvisioningWorkspace,
	error: provisionWorkspaceError,
	execute: provisionWorkspace,
} = useApiAction(async () => {
	await sessionStore.provisionDefaultWorkspace(provisionWorkspaceForm.toModel())
	queryCache.invalidate(queryKeys.workspacePortfolios())
	toastStore.success({ title: 'Workspace created and Portfolio selected.' })
	await navigateTo('/projects')
})

const {
	isLoading: isSelectingPortfolio,
	error: selectPortfolioError,
	execute: executeSelectPortfolio,
} = useApiAction(async (workspaceId: string, portfolioId: string) => {
	await sessionStore.setSelection(workspaceId, portfolioId)
	toastStore.success({ title: 'Portfolio selected.' })
	await navigateTo('/projects')
})

async function selectPortfolio(workspaceId: string, portfolioId: string): Promise<void> {
	selectingPortfolioKey.value = portfolioActionKey(workspaceId, portfolioId)
	await executeSelectPortfolio(workspaceId, portfolioId)
}

const {
	isLoading: isClearingSelection,
	error: clearSelectionError,
	execute: clearSelection,
} = useApiAction(async () => {
	await sessionStore.clearSelection()
	toastStore.info({ title: 'Selection cleared.' })
})

const {
	isLoading: isLoggingOut,
	error: logoutError,
	execute: logout,
} = useApiAction(async () => {
	await sessionStore.logout()
	if (typeof window !== 'undefined') window.location.assign('/sign-in')
	else await navigateTo('/sign-in')
})

function isSelectingThisPortfolio(workspaceId: string, portfolioId: string): boolean {
	return isSelectingPortfolio.value && selectingPortfolioKey.value === portfolioActionKey(workspaceId, portfolioId)
}

function portfolioSelectionError(workspaceId: string, portfolioId: string): string {
	return selectingPortfolioKey.value === portfolioActionKey(workspaceId, portfolioId) ? selectPortfolioError.value : ''
}

function portfolioActionKey(workspaceId: string, portfolioId: string): string {
	return `${workspaceId}:${portfolioId}`
}
</script>
