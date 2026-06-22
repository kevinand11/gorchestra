<template>
	<NuxtLayout
		name="project"
		:project-id="projectId"
		:project-title="project?.title ?? 'Loading Project…'"
		:project-subtitle="projectSubtitle">
		<section>
			<div v-if="isLoadingRepositoryPage" class="border-b border-dimmer px-3 py-4 text-dim">Loading Repository…</div>
			<div v-else-if="repositoryPageError" class="border-b border-dimmer px-3 py-4 text-error">{{ repositoryPageError }}</div>
			<div v-else-if="repository && project" class="grid gap-0">
				<p v-if="isRefreshingRepositoryPage" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
					Refreshing Repository details…
				</p>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">{{ repository.config.owner }}/{{ repository.config.name }}</h2>
					<div class="mt-2 grid gap-2 text-sz-helper sm:grid-cols-2">
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Provider</span><span>{{ repository.config.provider }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Secret</span><span :class="secretToneClass">{{ secretLabel }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Created</span><span>{{ formatDate(repository.created.at) }}</span>
						</div>
					</div>
				</section>

				<section class="px-3 py-3">
					<div class="border border-dimmer bg-card p-3">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div>
								<h2 class="m-0 text-sz-subsection font-semibold">Repository Preflight</h2>
								<p class="m-0 mt-1 text-sz-helper text-dim">
									Check whether this GitHub Repository is ready for provider access.
								</p>
							</div>
							<UiButton :loading="isPreflightingRepository" @click="preflightRepository()">Run Preflight</UiButton>
						</div>
						<UiText v-if="preflightRepositoryError" class="mt-3" tone="error">{{ preflightRepositoryError }}</UiText>
						<div v-if="preflightEvidence" class="mt-3 border border-dimmer bg-canvas p-3">
							<p class="m-0 font-semibold" :class="preflightEvidence.passed ? 'text-success' : 'text-error'">
								{{ preflightEvidence.passed ? 'Preflight passed.' : 'Preflight failed.' }}
							</p>
							<p class="m-0 mt-1 text-sz-helper text-dim">{{ preflightEvidence.summary }}</p>
						</div>
					</div>
				</section>
			</div>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
import UiButton from '../../../../components/ui/UiButton.vue'
import UiText from '../../../../components/ui/UiText.vue'
import { useApiAction } from '../../../../composables/action-state'
import {
	usePortfolioProjectQuery,
	usePortfolioRepositoryQuery,
	usePortfolioSecretsQuery,
} from '../../../../composables/portfolio-resource-queries'
import { useServerApi, type ServerApi } from '../../../../composables/useServerApi'
import { useToastStore } from '../../../../stores/toasts'
import { formatDate } from '../../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type RepositoryPreflightEvidence = Awaited<ReturnType<ServerApi['preflightRepository']>>

const route = useRoute()
const serverApi = useServerApi()
const toastStore = useToastStore()
const projectId = computed(() => route.params.projectId as string)
const repositoryId = computed(() => route.params.repositoryId as string)
const preflightEvidence = ref<RepositoryPreflightEvidence | null>(null)

const {
	data: project,
	isLoading: isLoadingProject,
	error: projectError,
	hasExecuted: hasLoadedProject,
} = usePortfolioProjectQuery(serverApi, projectId)

const {
	data: repository,
	isLoading: isLoadingRepository,
	error: repositoryError,
	hasExecuted: hasLoadedRepository,
} = usePortfolioRepositoryQuery(serverApi, projectId, repositoryId)

const {
	data: secrets,
	isLoading: isLoadingSecrets,
	error: secretsError,
	hasExecuted: hasLoadedSecrets,
} = usePortfolioSecretsQuery(serverApi)

const secretsById = computed(() => new Map(secrets.value.map((secret) => [secret.id, secret])))
const referencedSecret = computed(() => {
	const secretId = repository.value?.config.secretId
	return secretId === undefined ? undefined : secretsById.value.get(secretId)
})
const secretLabel = computed(() => {
	const secretId = repository.value?.config.secretId
	if (secretId === undefined) return 'Loading Secret…'
	const secret = referencedSecret.value
	if (secret === undefined) return 'not found'
	return secret.archived ? `${secret.name} — archived` : secret.name
})
const secretToneClass = computed(() => {
	if (repository.value === null) return 'text-dim'
	const secret = referencedSecret.value
	return secret === undefined || secret.archived ? 'text-error' : 'text-success'
})
const projectSubtitle = computed(() => {
	const config = repository.value?.config
	return config === undefined ? 'Repository detail' : `${config.owner}/${config.name}`
})

const repositoryPageFetches = [
	{ isLoading: isLoadingProject, hasExecuted: hasLoadedProject },
	{ isLoading: isLoadingRepository, hasExecuted: hasLoadedRepository },
	{ isLoading: isLoadingSecrets, hasExecuted: hasLoadedSecrets },
]
const isLoadingRepositoryPage = computed(() => repositoryPageFetches.some((fetch) => fetch.isLoading.value && !fetch.hasExecuted.value))
const repositoryPageError = computed(() => projectError.value || repositoryError.value || secretsError.value)
const isRefreshingRepositoryPage = computed(() => repositoryPageFetches.some((fetch) => fetch.isLoading.value && fetch.hasExecuted.value))

const {
	isLoading: isPreflightingRepository,
	error: preflightRepositoryError,
	execute: preflightRepository,
} = useApiAction(async () => {
	const evidence = await serverApi.preflightRepository(projectId.value, repositoryId.value)
	preflightEvidence.value = evidence
	if (evidence.passed) toastStore.success({ title: 'Repository preflight passed.', body: evidence.summary })
	else toastStore.info({ title: 'Repository preflight failed.', body: evidence.summary })
})
</script>
