<template>
	<NuxtLayout name="project" :project-id="projectId">
		<section class="px-3 py-3">
			<div v-if="isLoadingSetup && !hasLoadedSetup" class="text-dim">Loading Repository setup…</div>
			<div v-else-if="setupError" class="text-error">{{ setupError }}</div>
			<div v-else class="grid max-w-[760px] gap-4">
				<p v-if="isRefreshingSetup" class="m-0 text-sz-helper text-dim">Refreshing Repository setup…</p>
				<div v-if="activeSecrets.length === 0" class="border border-dashed border-dimmer p-5">
					<h2 class="m-0 text-sz-subsection font-semibold">Create an active Secret first.</h2>
					<p class="m-0 mt-1 text-sz-helper text-dim">
						A GitHub Repository needs an active Secret containing a GitHub PAT before it can be configured.
					</p>
					<NuxtLink
						class="mt-4 inline-flex border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast"
						to="/secrets/new">
						Create Secret
					</NuxtLink>
				</div>

				<UiForm v-else @submit.prevent="createRepository()">
					<div class="grid gap-3 md:grid-cols-2">
						<UiFormGroup label="GitHub owner" for-id="github-owner" :error="repositoryCreationForm.errors.owner">
							<UiInput
								id="github-owner"
								v-model="repositoryCreationForm.owner"
								required
								placeholder="octocat"
								:invalid="!!repositoryCreationForm.errors.owner" />
						</UiFormGroup>
						<UiFormGroup label="Repository name" for-id="github-repository" :error="repositoryCreationForm.errors.name">
							<UiInput
								id="github-repository"
								v-model="repositoryCreationForm.name"
								required
								placeholder="Hello-World"
								:invalid="!!repositoryCreationForm.errors.name" />
						</UiFormGroup>
					</div>

					<UiFormGroup label="GitHub access Secret" for-id="github-secret" :error="repositoryCreationForm.errors.secretId">
						<UiSelect
							id="github-secret"
							v-model="repositoryCreationForm.secretId"
							:options="activeSecretOptions"
							placeholder="Select an active Secret"
							:invalid="!!repositoryCreationForm.errors.secretId" />
					</UiFormGroup>
					<UiText tone="muted" size="helper"
						>Secret values stay protected; the Repository stores only a reference to the selected Secret.</UiText
					>

					<div class="flex flex-wrap items-center gap-2">
						<UiButton type="submit" :loading="isCreatingRepository" :disabled="!repositoryCreationForm.valid">
							Create Repository
						</UiButton>
					</div>
					<UiText v-if="createRepositoryError" tone="error">{{ createRepositoryError }}</UiText>
				</UiForm>
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
import { computed } from 'vue'

import UiButton from '../../../../components/ui/UiButton.vue'
import UiForm from '../../../../components/ui/UiForm.vue'
import UiFormGroup from '../../../../components/ui/UiFormGroup.vue'
import UiInput from '../../../../components/ui/UiInput.vue'
import UiSelect from '../../../../components/ui/UiSelect.vue'
import UiText from '../../../../components/ui/UiText.vue'
import { useApiAction } from '../../../../composables/action-state'
import { usePortfolioSecretsQuery } from '../../../../composables/portfolio-resource-queries'
import { useQueryCache } from '../../../../composables/query-cache'
import { useSelectedPortfolio } from '../../../../composables/selected-portfolio'
import { useServerApi } from '../../../../composables/useServerApi'
import { RepositoryCreationFormDraft } from '../../../../forms/repository'
import { useToasts } from '../../../../composables/toasts'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const projectId = computed(() => route.params.projectId as string)
const { portfolio } = useSelectedPortfolio()
const serverApi = useServerApi()
const toasts = useToasts()
const { queryKeys, invalidate } = useQueryCache()
const repositoryCreationForm = new RepositoryCreationFormDraft()

const {
	data: secrets,
	isLoading: isLoadingSecrets,
	error: secretsError,
	hasExecuted: hasLoadedSecrets,
} = usePortfolioSecretsQuery(serverApi)

const activeSecrets = computed(() => secrets.value.filter((secret) => !secret.archived))
const activeSecretOptions = computed(() => activeSecrets.value.map((secret) => ({ value: secret.id, label: secret.name })))

const isLoadingSetup = computed(() => isLoadingSecrets.value && !hasLoadedSecrets.value)
const setupError = computed(() => secretsError.value)
const hasLoadedSetup = computed(() => hasLoadedSecrets.value)
const isRefreshingSetup = computed(() => isLoadingSecrets.value && hasLoadedSecrets.value)

const {
	isLoading: isCreatingRepository,
	error: createRepositoryError,
	execute: createRepository,
} = useApiAction(async () => {
	const repository = await serverApi.createRepository(projectId.value, repositoryCreationForm.toModel())
	invalidate(queryKeys.portfolio.projects(portfolio.value.id), { exact: true })
	invalidate(queryKeys.portfolio.project(portfolio.value.id, projectId.value))
	toasts.success({ title: 'Repository created.', body: `${repository.config.owner}/${repository.config.name}` })
	await navigateTo(`/projects/${projectId.value}/repositories/${repository.id}`)
})
</script>
