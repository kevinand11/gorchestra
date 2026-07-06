<template>
	<NuxtLayout name="default" topbar-subtitle="Choose the Workspace and Portfolio context for this browser.">
		<template #topbar-right>
			<div class="grid justify-items-end gap-1">
				<UiButton type="button" variant="secondary" :loading="isSigningOut" @click="signOut()">Sign out</UiButton>
				<UiText v-if="signOutError" tone="error" size="helper">{{ signOutError }}</UiText>
			</div>
		</template>

		<header class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Select Portfolio</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Selection is explicit and revalidated before Portfolio-scoped work.</p>
		</header>

		<section>
			<div v-if="isLoadingWorkspaces && !hasLoadedWorkspaces" class="border-b border-dimmer px-3 py-4 text-dim">
				Loading your Workspaces…
			</div>
			<div v-else-if="workspacesError" class="border-b border-dimmer px-3 py-4 text-error">
				{{ workspacesError }}
			</div>
			<div v-else>
				<div v-if="hasNoSelectablePortfolios" class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">
						{{ workspaces.length === 0 ? 'Provision your first Workspace' : 'Provision a Workspace with a Default Portfolio' }}
					</h2>
					<p class="m-0 mt-1 text-sz-helper text-dim">
						No accessible Portfolio is available yet. Workspace Provisioning creates a Workspace, registers its Default
						Portfolio, and selects it for this browser.
					</p>
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

				<div v-if="workspaces.length > 0">
					<div class="flex min-h-11 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
						<strong class="font-semibold">Available Workspaces</strong>
						<span v-if="isRefreshingWorkspaces" class="text-sz-helper text-dim">Refreshing…</span>
					</div>
					<div>
						<div v-for="workspace in workspaces" :key="workspace.id" class="border-b border-dimmer">
							<div class="grid min-h-[58px] grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
								<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">W</span>
								<span class="min-w-0">
									<strong class="block truncate font-semibold">{{ workspace.displayName }}</strong>
									<span class="block truncate text-sz-helper text-dim">
										{{ workspace.ownerRole ? 'Active Workspace Owner' : 'Active Member' }}
									</span>
								</span>
								<span class="text-sz-helper text-dim">{{ workspace.portfolios.length }} Portfolios</span>
							</div>
							<div v-if="workspace.portfolios.length === 0" class="px-9 pb-3 text-sz-helper text-dim">
								No Portfolios registered for this Workspace.
							</div>
							<div v-else>
								<div
									v-for="portfolio in workspace.portfolios"
									:key="portfolio.id"
									class="grid min-h-[52px] grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 border-t border-dimmer px-3 py-2">
									<span class="ml-4 grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">P</span>
									<span class="min-w-0">
										<strong class="block truncate font-semibold">{{ portfolio.displayName }}</strong>
										<span class="block truncate text-sz-helper text-dim">{{ workspace.displayName }}</span>
									</span>
									<NuxtLink
										v-if="isCurrentSelection(workspace.id, portfolio.id)"
										class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast"
										to="/projects">
										Go to Projects
									</NuxtLink>
									<div v-else class="grid justify-items-end gap-1">
										<UiButton
											type="button"
											:disabled="isSelectingPortfolio"
											:loading="isSelectingThisPortfolio(workspace.id, portfolio.id)"
											@click="selectPortfolio(workspace.id, portfolio.id)">
											{{ isSelectingThisPortfolio(workspace.id, portfolio.id) ? 'Selecting…' : 'Select Portfolio' }}
										</UiButton>
										<UiText v-if="portfolioSelectionError(workspace.id, portfolio.id)" tone="error" size="helper">
											{{ portfolioSelectionError(workspace.id, portfolio.id) }}
										</UiText>
									</div>
								</div>
							</div>
						</div>
						<div v-if="hasNextWorkspaces" class="border-b border-dimmer px-3 py-3">
							<UiButton type="button" variant="secondary" :loading="isLoadingWorkspaces" @click="fetchNextWorkspaces()">
								Load more Workspaces
							</UiButton>
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
import { useAuth, useSelectionClear, useSignout } from '../composables/auth/session'
import { useDefaultWorkspaceProvision, usePortfolioSelection, useWorkspacesList } from '../composables/auth/workspaces'

definePageMeta({ middleware: ['is-authenticated'] })

const {
	workspaces,
	isLoadingWorkspaces,
	workspacesError,
	hasLoadedWorkspaces,
	isRefreshingWorkspaces,
	fetchNextWorkspaces,
	hasNextWorkspaces,
	hasNoSelectablePortfolios,
} = useWorkspacesList()
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

const { selection } = useAuth()
const { isClearingSelection, clearSelectionError, clearSelection } = useSelectionClear()
const { isSigningOut, signOutError, signOut } = useSignout()

function isCurrentSelection(workspaceId: string, portfolioId: string): boolean {
	return (
		selection.value?.selected === true && selection.value.workspace.id === workspaceId && selection.value.portfolio.id === portfolioId
	)
}
</script>
