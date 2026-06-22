<template>
	<NuxtLayout
		name="project"
		:project-id="projectId"
		:project-title="project?.title ?? 'Loading Project…'"
		:project-subtitle="projectSubtitle">
		<section class="px-3 py-3">
			<div v-if="isLoadingSetup && !hasLoadedSetup" class="text-dim">Loading Repository setup…</div>
			<div v-else-if="setupError" class="text-error">{{ setupError }}</div>
			<div v-else-if="project" class="grid max-w-[760px] gap-4">
				<p v-if="isRefreshingSetup" class="m-0 text-sz-helper text-dim">Refreshing Repository setup…</p>
				<div v-if="activeSecrets.length === 0" class="border border-dashed border-dimmer p-5">
					<h2 class="m-0 text-sz-subsection font-semibold">Create an active Secret first.</h2>
					<p class="m-0 mt-1 text-sz-helper text-dim">
						A GitHub Repository needs an active Secret containing a GitHub PAT before it can be configured.
					</p>
					<NuxtLink
						class="mt-4 inline-flex border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast no-underline"
						to="/secrets/new">
						Create Secret
					</NuxtLink>
				</div>

				<form v-else class="grid gap-3" @submit.prevent="createRepository()">
					<div class="grid gap-3 md:grid-cols-2">
						<label class="grid gap-1.5 font-semibold" for="github-owner">
							GitHub owner
							<UiInput
								id="github-owner"
								v-model="repositoryCreationForm.owner"
								required
								placeholder="octocat"
								:invalid="!!repositoryCreationForm.errors.owner" />
						</label>
						<label class="grid gap-1.5 font-semibold" for="github-repository">
							Repository name
							<UiInput
								id="github-repository"
								v-model="repositoryCreationForm.name"
								required
								placeholder="Hello-World"
								:invalid="!!repositoryCreationForm.errors.name" />
						</label>
					</div>
					<div class="grid gap-1.5">
						<UiText v-if="repositoryCreationForm.errors.owner" tone="error" size="helper">
							{{ repositoryCreationForm.errors.owner }}
						</UiText>
						<UiText v-if="repositoryCreationForm.errors.name" tone="error" size="helper">
							{{ repositoryCreationForm.errors.name }}
						</UiText>
					</div>

					<label class="grid gap-1.5 font-semibold" for="github-secret">
						GitHub access Secret
						<UiSelect
							id="github-secret"
							v-model="repositoryCreationForm.secretId"
							required
							:invalid="!!repositoryCreationForm.errors.secretId">
							<option value="">Select an active Secret</option>
							<option v-for="secret in activeSecrets" :key="secret.id" :value="secret.id">
								{{ secret.name }}
							</option>
						</UiSelect>
					</label>
					<UiText v-if="repositoryCreationForm.errors.secretId" tone="error" size="helper">
						{{ repositoryCreationForm.errors.secretId }}
					</UiText>
					<UiText tone="muted" size="helper"
						>Secret values stay protected; the Repository stores only a reference to the selected Secret.</UiText
					>

					<div class="flex flex-wrap items-center gap-2">
						<UiButton type="submit" :loading="isCreatingRepository" :disabled="!repositoryCreationForm.valid">
							Create Repository
						</UiButton>
					</div>
					<UiText v-if="createRepositoryError" tone="error">{{ createRepositoryError }}</UiText>
				</form>
			</div>
		</section>

		<template #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Repository setup</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">GitHub only</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					This form stores the GitHub owner, Repository name, and selected access Secret.
				</p>
			</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">Preflight comes next</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					After creation, open Repository detail to run a live provider access check.
				</p>
			</div>
			<div class="px-3 py-3">
				<strong class="block font-semibold">Protected values</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">Plaintext Secret values are never returned to the browser.</p>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import UiButton from '../../../../components/ui/UiButton.vue'
import UiInput from '../../../../components/ui/UiInput.vue'
import UiSelect from '../../../../components/ui/UiSelect.vue'
import UiText from '../../../../components/ui/UiText.vue'
import { useApiAction } from '../../../../composables/action-state'
import { usePortfolioProjectQuery, usePortfolioSecretsQuery } from '../../../../composables/portfolio-resource-queries'
import { useQueryCache } from '../../../../composables/query-cache'
import { useSelectedPortfolio } from '../../../../composables/selected-portfolio'
import { useServerApi } from '../../../../composables/useServerApi'
import { RepositoryCreationFormFactory } from '../../../../forms/repository'
import { useToastStore } from '../../../../stores/toasts'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const selectedPortfolio = useSelectedPortfolio()
const serverApi = useServerApi()
const toastStore = useToastStore()
const queryCache = useQueryCache()
const { queryKeys } = queryCache
const portfolioId = computed(() => selectedPortfolio.value.portfolio.id)
const projectId = computed(() => routeParam(route.params.projectId))
const repositoryCreationForm = new RepositoryCreationFormFactory()

const {
	data: project,
	isLoading: isLoadingProject,
	error: projectError,
	hasExecuted: hasLoadedProject,
} = usePortfolioProjectQuery(serverApi, projectId)

const {
	data: secrets,
	isLoading: isLoadingSecrets,
	error: secretsError,
	hasExecuted: hasLoadedSecrets,
} = usePortfolioSecretsQuery(serverApi)

const activeSecrets = computed(() => secrets.value.filter((secret) => !secret.archived))
const projectSubtitle = computed(() =>
	project.value === null ? 'Add a GitHub Repository.' : `Add a GitHub Repository to ${project.value.title}.`,
)
const isLoadingSetup = computed(
	() => (isLoadingProject.value && !hasLoadedProject.value) || (isLoadingSecrets.value && !hasLoadedSecrets.value),
)
const setupError = computed(() => projectError.value || secretsError.value)
const hasLoadedSetup = computed(() => hasLoadedProject.value && hasLoadedSecrets.value)
const isRefreshingSetup = computed(
	() => (isLoadingProject.value && hasLoadedProject.value) || (isLoadingSecrets.value && hasLoadedSecrets.value),
)

const {
	isLoading: isCreatingRepository,
	error: createRepositoryError,
	execute: createRepository,
} = useApiAction(async () => {
	const repository = await serverApi.createRepository(projectId.value, repositoryCreationForm.toModel())
	queryCache.invalidate(queryKeys.portfolio.projects(portfolioId.value), { exact: true })
	queryCache.invalidate(queryKeys.portfolio.project(portfolioId.value, projectId.value))
	toastStore.success({ title: 'Repository created.', body: `${repository.config.owner}/${repository.config.name}` })
	await navigateTo(`/projects/${projectId.value}/repositories/${repository.id}`)
})

function routeParam(value: string | string[]): string {
	return Array.isArray(value) ? (value[0] ?? '') : value
}
</script>
