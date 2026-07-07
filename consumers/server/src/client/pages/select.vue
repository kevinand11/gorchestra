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
			<p class="m-0 mt-1 text-sz-helper text-dim">
				Workspaces contain Portfolios. Select a Portfolio before opening Portfolio-scoped work.
			</p>
		</header>

		<section>
			<div class="flex min-h-12 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
				<div class="min-w-0">
					<strong class="block font-semibold">Workspace hierarchy</strong>
					<p class="m-0 mt-0.5 text-sz-helper text-dim">
						Create Workspaces separately, then add Portfolios under owned Workspaces.
					</p>
				</div>
				<UiButton v-if="!isWorkspaceCreationOpen" type="button" variant="secondary" @click="openWorkspaceCreation()">
					New Workspace
				</UiButton>
			</div>

			<div v-if="isWorkspaceCreationOpen" class="border-b border-dimmer px-3 py-3">
				<UiForm class="max-w-[520px]" @submit.prevent="createWorkspace()">
					<UiFormGroup label="Workspace display name" for-id="workspace-name" :error="workspaceCreationForm.errors.displayName">
						<UiInput
							id="workspace-name"
							v-model="workspaceCreationForm.displayName"
							required
							placeholder="Delivery Ops"
							:invalid="!!workspaceCreationForm.errors.displayName" />
					</UiFormGroup>
					<div class="flex flex-wrap items-center gap-2">
						<UiButton type="submit" :loading="isCreatingWorkspace" :disabled="!workspaceCreationForm.valid">
							Create Workspace
						</UiButton>
						<UiButton type="button" variant="ghost" :disabled="isCreatingWorkspace" @click="closeWorkspaceCreation()"
							>Cancel</UiButton
						>
					</div>
					<UiText v-if="createWorkspaceError" tone="error">{{ createWorkspaceError }}</UiText>
				</UiForm>
			</div>

			<div v-if="isLoadingWorkspaces && !hasLoadedWorkspaces" class="border-b border-dimmer px-3 py-4 text-dim">
				Loading your Workspaces…
			</div>
			<div v-else-if="workspacesError" class="border-b border-dimmer px-3 py-4 text-error">
				{{ workspacesError }}
			</div>
			<div v-else-if="hasNoWorkspaces" class="border-b border-dimmer px-3 py-4">
				<strong class="block font-semibold">No Workspaces yet</strong>
				<p class="m-0 mt-1 text-sz-helper text-dim">
					Create a Workspace first. Portfolio Creation stays inside the Workspace after it exists.
				</p>
				<UiButton type="button" class="mt-3" variant="secondary" @click="openWorkspaceCreation()">New Workspace</UiButton>
			</div>
			<div v-else>
				<div v-if="isRefreshingWorkspaces" class="border-b border-dimmer px-3 py-2 text-sz-helper text-dim">Refreshing…</div>
				<section v-for="workspace in workspaces" :key="workspace.id" class="border-b border-dimmer">
					<div class="grid min-h-[58px] grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
						<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">W</span>
						<span class="min-w-0">
							<strong class="block truncate font-semibold">{{ workspace.displayName }}</strong>
							<span class="block truncate text-sz-helper text-dim">
								{{ workspace.ownerRole ? 'Active Workspace Owner' : 'Active Member' }}
							</span>
						</span>
						<UiButton
							v-if="workspace.ownerRole && !isPortfolioCreationOpen(workspace.id)"
							type="button"
							variant="secondary"
							:disabled="isCreatingPortfolio"
							@click="openPortfolioCreation(workspace.id)">
							New Portfolio
						</UiButton>
					</div>

					<div v-if="isPortfolioCreationOpen(workspace.id)" class="border-t border-dimmer">
						<div class="grid grid-cols-[16px_minmax(0,520px)] gap-3 px-3 py-3 pl-8">
							<span class="self-stretch border-l border-dimmer"></span>
							<UiForm @submit.prevent="createPortfolio()">
								<UiFormGroup
									label="Portfolio display name"
									:for-id="`portfolio-name-${workspace.id}`"
									:error="portfolioCreationForm.errors.displayName">
									<UiInput
										:id="`portfolio-name-${workspace.id}`"
										v-model="portfolioCreationForm.displayName"
										required
										placeholder="Main Portfolio"
										:invalid="!!portfolioCreationForm.errors.displayName" />
								</UiFormGroup>
								<div class="flex flex-wrap items-center gap-2">
									<UiButton type="submit" :loading="isCreatingPortfolio" :disabled="!portfolioCreationForm.valid">
										Create Portfolio
									</UiButton>
									<UiButton
										type="button"
										variant="ghost"
										:disabled="isCreatingPortfolio"
										@click="closePortfolioCreation()">
										Cancel
									</UiButton>
								</div>
								<UiText v-if="createPortfolioError" tone="error">{{ createPortfolioError }}</UiText>
							</UiForm>
						</div>
					</div>

					<div v-if="workspace.portfolios.length === 0" class="border-t border-dimmer">
						<div
							class="grid min-h-[48px] grid-cols-[16px_minmax(0,1fr)] items-center gap-3 px-3 py-2 pl-8 text-sz-helper text-dim">
							<span class="self-stretch border-l border-dimmer"></span>
							<span>
								{{
									workspace.ownerRole
										? 'No Portfolios registered for this Workspace.'
										: 'No Portfolios registered for this Workspace. Ask a Workspace Owner to create one.'
								}}
							</span>
						</div>
					</div>
					<div v-else>
						<div v-for="portfolio in workspace.portfolios" :key="portfolio.id" class="border-t border-dimmer">
							<div class="grid min-h-[52px] grid-cols-[16px_24px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 pl-8">
								<span class="self-stretch border-l border-dimmer"></span>
								<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">P</span>
								<span class="min-w-0">
									<strong class="block truncate font-semibold">{{ portfolio.displayName }}</strong>
								</span>
								<NuxtLink
									v-if="isCurrentSelection(workspace.id, portfolio.id)"
									class="border border-dimmer bg-secondary px-3 py-1.5 text-sz-helper font-semibold text-secondary-contrast hover:border-dim hover:brightness-110"
									to="/projects">
									Open Projects
								</NuxtLink>
								<div v-else class="grid justify-items-end gap-1">
									<UiButton
										type="button"
										:disabled="isSelectingPortfolio"
										:loading="isSelectingThisPortfolio(workspace.id, portfolio.id)"
										@click="selectPortfolio(workspace.id, portfolio.id)">
										{{ isSelectingThisPortfolio(workspace.id, portfolio.id) ? 'Selecting…' : 'Select' }}
									</UiButton>
									<UiText v-if="portfolioSelectionError(workspace.id, portfolio.id)" tone="error" size="helper">
										{{ portfolioSelectionError(workspace.id, portfolio.id) }}
									</UiText>
								</div>
							</div>
						</div>
					</div>
				</section>
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
					<UiButton type="button" variant="secondary" :loading="isClearingSelection" @click="clearSelection()">
						Clear selection
					</UiButton>
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
import { ref } from 'vue'

import UiButton from '../components/ui/UiButton.vue'
import UiForm from '../components/ui/UiForm.vue'
import UiFormGroup from '../components/ui/UiFormGroup.vue'
import UiInput from '../components/ui/UiInput.vue'
import UiText from '../components/ui/UiText.vue'
import { useAuth, useSelectionClear, useSignout } from '../composables/auth/session'
import {
	usePortfolioSelection,
	useWorkspaceCreation,
	useWorkspacePortfolioCreation,
	useWorkspacesList,
} from '../composables/auth/workspaces'

definePageMeta({ middleware: ['is-authenticated'] })

const isWorkspaceCreationOpen = ref(false)
const { workspaces, isLoadingWorkspaces, workspacesError, hasLoadedWorkspaces, isRefreshingWorkspaces, hasNoWorkspaces } =
	useWorkspacesList()
const { workspaceCreationForm, isCreatingWorkspace, createWorkspaceError, createWorkspace, resetCreateWorkspace } = useWorkspaceCreation({
	onSuccess: () => {
		isWorkspaceCreationOpen.value = false
	},
})
const {
	portfolioCreationForm,
	isCreatingPortfolio,
	createPortfolioError,
	createPortfolio,
	openPortfolioCreation,
	closePortfolioCreation,
	isPortfolioCreationOpen,
} = useWorkspacePortfolioCreation({ workspaces })
const { isSelectingPortfolio, selectPortfolio, isSelectingThisPortfolio, portfolioSelectionError } = usePortfolioSelection({
	onSuccess: async () => {
		await navigateTo('/projects')
	},
})

const { selection } = useAuth()
const { isClearingSelection, clearSelectionError, clearSelection } = useSelectionClear()
const { isSigningOut, signOutError, signOut } = useSignout()

function openWorkspaceCreation(): void {
	resetCreateWorkspace()
	workspaceCreationForm.reset()
	isWorkspaceCreationOpen.value = true
}

function closeWorkspaceCreation(): void {
	resetCreateWorkspace()
	workspaceCreationForm.reset()
	isWorkspaceCreationOpen.value = false
}

function isCurrentSelection(workspaceId: string, portfolioId: string): boolean {
	return (
		selection.value?.selected === true && selection.value.workspace.id === workspaceId && selection.value.portfolio.id === portfolioId
	)
}
</script>
