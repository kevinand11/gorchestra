<template>
	<SelectedPortfolioShell>
		<UiHero>
			<UiText as="p" tone="primary" class="font-bold uppercase tracking-[0.16em]">New Repository</UiText>
			<UiHeading as="h1" size="hero">Add a GitHub Repository.</UiHeading>
			<UiText size="lede" tone="muted">Connect a GitHub Repository to {{ project?.title ?? 'this Project' }}.</UiText>
		</UiHero>

		<UiCard>
			<UiText v-if="isLoadingSetup && !hasLoadedSetup" tone="muted">Loading Repository setup…</UiText>
			<UiText v-else-if="setupError" tone="error">{{ setupError }}</UiText>
			<div v-else-if="project" class="grid gap-5">
				<div class="grid gap-2 rounded-list-item border border-dimmer bg-dimmer p-3.5">
					<UiHeading as="h2" size="section">{{ project.title }}</UiHeading>
					<UiText tone="muted">Provider: GitHub</UiText>
					<UiText tone="muted">Repository target writes validate the selected Secret without calling GitHub.</UiText>
				</div>

				<div v-if="activeSecrets.length === 0" class="grid gap-3">
					<UiHeading as="h2" size="section">Create an active Secret first.</UiHeading>
					<UiText tone="muted">
						A GitHub Repository needs an active Secret containing a GitHub PAT before it can be configured.
					</UiText>
					<div class="flex flex-wrap items-center gap-3">
						<NuxtLink
							class="inline-flex w-fit items-center justify-center rounded-pill bg-primary px-5 py-3 font-extrabold text-primary-contrast no-underline transition hover:brightness-110"
							to="/secrets/new">
							Create Secret
						</NuxtLink>
						<NuxtLink
							class="inline-flex w-fit items-center justify-center rounded-pill border border-dimmer bg-secondary px-5 py-3 font-extrabold text-secondary-contrast no-underline transition hover:border-primary"
							:to="`/projects/${project.id}`">
							Back to Project
						</NuxtLink>
					</div>
				</div>

				<form v-else class="grid max-w-[560px] gap-4" @submit.prevent="createRepository()">
					<label class="grid gap-2 font-bold text-dim">
						GitHub owner
						<UiInput
							v-model="repositoryCreationForm.owner"
							required
							placeholder="octocat"
							:invalid="!!repositoryCreationForm.errors.owner" />
					</label>
					<UiText v-if="repositoryCreationForm.errors.owner" tone="error" size="helper">
						{{ repositoryCreationForm.errors.owner }}
					</UiText>

					<label class="grid gap-2 font-bold text-dim">
						GitHub Repository name
						<UiInput
							v-model="repositoryCreationForm.name"
							required
							placeholder="Hello-World"
							:invalid="!!repositoryCreationForm.errors.name" />
					</label>
					<UiText v-if="repositoryCreationForm.errors.name" tone="error" size="helper">
						{{ repositoryCreationForm.errors.name }}
					</UiText>

					<label class="grid gap-2 font-bold text-dim">
						GitHub access Secret
						<UiSelect v-model="repositoryCreationForm.secretId" required :invalid="!!repositoryCreationForm.errors.secretId">
							<option value="">Select an active Secret</option>
							<option v-for="secret in activeSecrets" :key="secret.id" :value="secret.id">
								{{ secret.name }} ({{ shortId(secret.id) }})
							</option>
						</UiSelect>
					</label>
					<UiText v-if="repositoryCreationForm.errors.secretId" tone="error" size="helper">
						{{ repositoryCreationForm.errors.secretId }}
					</UiText>
					<UiText tone="muted" size="helper">
						Secret values stay protected; the Repository stores only the selected Secret id.
					</UiText>

					<div class="flex flex-wrap items-center gap-3">
						<UiButton type="submit" :loading="isCreatingRepository" :disabled="!repositoryCreationForm.valid">
							Create Repository
						</UiButton>
						<NuxtLink
							class="inline-flex items-center justify-center rounded-pill border border-dimmer bg-secondary px-5 py-3 font-extrabold text-secondary-contrast no-underline transition hover:border-primary"
							:to="`/projects/${project.id}`">
							Back to Project
						</NuxtLink>
					</div>
					<UiText v-if="createRepositoryError" tone="error">{{ createRepositoryError }}</UiText>
				</form>
			</div>
		</UiCard>
	</SelectedPortfolioShell>
</template>

<script setup lang="ts">
import SelectedPortfolioShell from '../../../../components/SelectedPortfolioShell.vue'
import UiButton from '../../../../components/ui/UiButton.vue'
import UiCard from '../../../../components/ui/UiCard.vue'
import UiHeading from '../../../../components/ui/UiHeading.vue'
import UiHero from '../../../../components/ui/UiHero.vue'
import UiInput from '../../../../components/ui/UiInput.vue'
import UiSelect from '../../../../components/ui/UiSelect.vue'
import UiText from '../../../../components/ui/UiText.vue'
import { useApiAction, useFetchAction } from '../../../../composables/action-state'
import { useServerApi, type ServerApi } from '../../../../composables/useServerApi'
import { RepositoryCreationFormFactory } from '../../../../forms/repository'
import { useToastStore } from '../../../../stores/toasts'

definePageMeta({ middleware: ['has-selection'] })

type ProjectDetails = Awaited<ReturnType<ServerApi['getProject']>>
type ListedSecret = Awaited<ReturnType<ServerApi['listSecrets']>>[number]

const route = useRoute()
const serverApi = useServerApi()
const toastStore = useToastStore()
const projectId = computed(() => routeParam(route.params.projectId))
const project = ref<ProjectDetails | null>(null)
const secrets = ref<ListedSecret[]>([])
const activeSecrets = computed(() => secrets.value.filter((secret) => !secret.archived))
const repositoryCreationForm = new RepositoryCreationFormFactory()

const {
	isLoading: isLoadingSetup,
	error: setupError,
	hasExecuted: hasLoadedSetup,
} = useFetchAction(
	async () => {
		const [loadedProject, loadedSecrets] = await Promise.all([serverApi.getProject(projectId.value), serverApi.listSecrets()])
		project.value = loadedProject
		secrets.value = loadedSecrets
	},
	{ dedupeKey: `selected-portfolio-repository-setup:${projectId.value}` },
)

const {
	isLoading: isCreatingRepository,
	error: createRepositoryError,
	execute: createRepository,
} = useApiAction(async () => {
	const repository = await serverApi.createRepository(projectId.value, repositoryCreationForm.toModel())
	toastStore.success({ title: 'Repository created.', body: `${repository.config.owner}/${repository.config.name}` })
	await navigateTo(`/projects/${projectId.value}/repositories/${repository.id}`)
})

function routeParam(value: string | string[]): string {
	return Array.isArray(value) ? (value[0] ?? '') : value
}

function shortId(id: string): string {
	return id.slice(0, 8)
}
</script>
