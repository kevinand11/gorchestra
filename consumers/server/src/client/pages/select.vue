<template>
	<NuxtLayout name="default" topbar-subtitle="Choose the Workspace and Portfolio context for this browser.">
		<template #topbar-right>
			<div class="grid justify-items-end gap-1">
				<UiButton type="button" variant="secondary" :loading="isLoggingOut" @click="logout()">Sign out</UiButton>
				<UiText v-if="logoutError" tone="error" size="helper">{{ logoutError }}</UiText>
			</div>
		</template>

		<header class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Select Portfolio</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Selection is explicit and revalidated before Portfolio-scoped work.</p>
		</header>

		<section>
			<div v-if="isLoadingWorkspacePortfolios && !hasLoadedWorkspacePortfolios" class="border-b border-dimmer px-3 py-4 text-dim">
				Loading your Workspaces…
			</div>
			<div v-else-if="workspacePortfoliosError" class="border-b border-dimmer px-3 py-4 text-error">
				{{ workspacePortfoliosError }}
			</div>
			<div v-else-if="workspacePortfolios.length === 0" class="px-3 py-3">
				<h2 class="m-0 text-sz-subsection font-semibold">Provision your first Workspace</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">No accessible Workspace and Portfolio is available yet.</p>
				<UiForm class="mt-4 max-w-[520px]" @submit.prevent="provisionWorkspace()">
					<UiFormGroup
						label="Workspace display name"
						for-id="workspace-name"
						:error="provisionWorkspaceForm.errors.workspaceDisplayName">
						<UiInput
							id="workspace-name"
							v-model="provisionWorkspaceForm.workspaceDisplayName"
							required
							placeholder="Delivery Ops"
							:invalid="!!provisionWorkspaceForm.errors.workspaceDisplayName" />
					</UiFormGroup>
					<UiFormGroup
						label="Portfolio display name"
						for-id="portfolio-name"
						:error="provisionWorkspaceForm.errors.portfolioDisplayName">
						<UiInput
							id="portfolio-name"
							v-model="provisionWorkspaceForm.portfolioDisplayName"
							required
							placeholder="Main Portfolio"
							:invalid="!!provisionWorkspaceForm.errors.portfolioDisplayName" />
					</UiFormGroup>
					<UiButton type="submit" :loading="isProvisioningWorkspace" :disabled="!provisionWorkspaceForm.valid">
						Create Workspace and select Default Portfolio
					</UiButton>
					<UiText v-if="provisionWorkspaceError" tone="error">{{ provisionWorkspaceError }}</UiText>
				</UiForm>
			</div>

			<div v-else>
				<div class="flex min-h-11 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
					<strong class="font-semibold">Available Portfolios</strong>
					<span v-if="isRefreshingWorkspacePortfolios" class="text-sz-helper text-dim">Refreshing…</span>
				</div>
				<div>
					<div
						v-for="access in workspacePortfolios"
						:key="`${access.workspace.id}:${access.portfolio.id}`"
						class="grid min-h-[58px] grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 border-b border-dimmer px-3 py-2">
						<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">P</span>
						<span class="min-w-0">
							<strong class="block truncate font-semibold">{{ access.portfolio.displayName }}</strong>
							<span class="block truncate text-sz-helper text-dim">{{ access.workspace.displayName }}</span>
						</span>
						<NuxtLink
							v-if="isCurrentSelection(access.workspace.id, access.portfolio.id)"
							class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast"
							to="/projects">
							Go to Projects
						</NuxtLink>
						<div v-else class="grid justify-items-end gap-1">
							<UiButton
								type="button"
								:disabled="isSelectingPortfolio"
								:loading="isSelectingThisPortfolio(access.workspace.id, access.portfolio.id)"
								@click="selectPortfolio(access.workspace.id, access.portfolio.id)">
								{{ isSelectingThisPortfolio(access.workspace.id, access.portfolio.id) ? 'Selecting…' : 'Select Portfolio' }}
							</UiButton>
							<UiText v-if="portfolioSelectionError(access.workspace.id, access.portfolio.id)" tone="error" size="helper">
								{{ portfolioSelectionError(access.workspace.id, access.portfolio.id) }}
							</UiText>
						</div>
					</div>
				</div>
			</div>
		</section>

		<template #right>
			<div v-if="selection?.selected">
				<div class="border-b border-dimmer px-3 py-2 font-semibold">Current selection</div>
				<div class="border-b border-dimmer px-3 py-3">
					<strong class="block font-semibold">{{ selection.portfolio.displayName }}</strong>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">{{ selection.workspace.displayName }}</p>
				</div>
				<div class="grid gap-2 px-3 py-3">
					<UiButton type="button" variant="secondary" :loading="isClearingSelection" @click="clearSelection()"
						>Clear selection</UiButton
					>
					<UiText v-if="clearSelectionError" tone="error">{{ clearSelectionError }}</UiText>
				</div>
			</div>
			<div v-else>
				<div class="border-b border-dimmer px-3 py-2 font-semibold">Selection required</div>
				<div class="border-b border-dimmer px-3 py-3">
					<strong class="block font-semibold">Choose a Portfolio</strong>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						A valid selection is required before opening Projects, Secrets, or Repository setup.
					</p>
				</div>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import UiButton from '../components/ui/UiButton.vue'
import UiForm from '../components/ui/UiForm.vue'
import UiFormGroup from '../components/ui/UiFormGroup.vue'
import UiInput from '../components/ui/UiInput.vue'
import UiText from '../components/ui/UiText.vue'
import {
	useCurrentSelection,
	useDefaultWorkspaceProvision,
	useLogoutAction,
	usePortfolioSelection,
	useSelectionClear,
	useWorkspacePortfoliosList,
} from '../composables/auth/selection'

definePageMeta({ middleware: ['is-authenticated'] })

const { selection } = useCurrentSelection()
const {
	workspacePortfolios,
	isLoadingWorkspacePortfolios,
	workspacePortfoliosError,
	hasLoadedWorkspacePortfolios,
	isRefreshingWorkspacePortfolios,
} = useWorkspacePortfoliosList()
const { provisionWorkspaceForm, isProvisioningWorkspace, provisionWorkspaceError, provisionWorkspace } = useDefaultWorkspaceProvision({
	onSuccess: async () => {
		await navigateTo('/projects')
	},
})
const { isSelectingPortfolio, selectPortfolio, isSelectingThisPortfolio, portfolioSelectionError } = usePortfolioSelection({
	onSuccess: async () => {
		await navigateTo('/projects')
	},
})
const { isClearingSelection, clearSelectionError, clearSelection } = useSelectionClear()
const { isLoggingOut, logoutError, logout } = useLogoutAction()

function isCurrentSelection(workspaceId: string, portfolioId: string): boolean {
	return (
		selection.value?.selected === true && selection.value.workspace.id === workspaceId && selection.value.portfolio.id === portfolioId
	)
}
</script>
