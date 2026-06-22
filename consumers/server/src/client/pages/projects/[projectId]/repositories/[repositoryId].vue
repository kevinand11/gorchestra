<template>
	<SelectedPortfolioShell>
		<UiHero>
			<UiText as="p" tone="primary" class="font-bold uppercase tracking-[0.16em]">Repository Details</UiText>
			<UiHeading as="h1" size="hero">{{ repositoryTitle }}</UiHeading>
			<UiText size="lede" tone="muted">Inspect the GitHub Repository target and validate provider access.</UiText>
		</UiHero>

		<UiCard>
			<UiText v-if="isLoadingRepositoryPage" tone="muted">Loading Repository…</UiText>
			<UiText v-else-if="repositoryPageError" tone="error">{{ repositoryPageError }}</UiText>
			<div v-else-if="repository && project" class="grid gap-5">
				<UiText v-if="isRefreshingRepositoryPage" tone="muted" size="helper">Refreshing Repository details…</UiText>
				<div class="grid gap-2">
					<UiHeading as="h2" size="section">{{ repository.config.owner }}/{{ repository.config.name }}</UiHeading>
					<UiText tone="muted">Project: {{ project.title }}</UiText>
					<UiText tone="muted">Repository id: {{ repository.id }}</UiText>
					<UiText tone="muted">Provider: {{ repository.config.provider }}</UiText>
					<UiText :tone="secretTone">Secret: {{ secretLabel }}</UiText>
					<UiText tone="muted">Created: {{ repository.created.at }}</UiText>
				</div>

				<div class="grid gap-3 rounded-list-item border border-dimmer bg-dimmer p-3.5">
					<UiHeading as="h2" size="section">Repository Preflight</UiHeading>
					<UiText tone="muted">
						Preflight checks whether this stored Repository is ready for GitHub access. It does not store lifecycle facts.
					</UiText>
					<div class="flex flex-wrap items-center gap-3">
						<UiButton :loading="isPreflightingRepository" @click="preflightRepository()">Run Preflight</UiButton>
						<NuxtLink
							class="inline-flex items-center justify-center rounded-pill border border-dimmer bg-secondary px-5 py-3 font-extrabold text-secondary-contrast no-underline transition hover:border-primary"
							:to="`/projects/${project.id}`">
							Back to Project
						</NuxtLink>
					</div>
					<UiText v-if="preflightRepositoryError" tone="error">{{ preflightRepositoryError }}</UiText>
					<div v-if="preflightEvidence" class="grid gap-1 rounded-list-item border border-dimmer bg-card p-3.5">
						<UiText :tone="preflightEvidence.passed ? 'success' : 'error'">
							{{ preflightEvidence.passed ? 'Preflight passed.' : 'Preflight failed.' }}
						</UiText>
						<UiText tone="muted">{{ preflightEvidence.summary }}</UiText>
					</div>
				</div>
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
import UiText from '../../../../components/ui/UiText.vue'
import { useApiAction } from '../../../../composables/action-state'
import {
	usePortfolioProjectQuery,
	usePortfolioRepositoryQuery,
	usePortfolioSecretsQuery,
} from '../../../../composables/portfolio-resource-queries'
import { useServerApi, type ServerApi } from '../../../../composables/useServerApi'
import { useToastStore } from '../../../../stores/toasts'

definePageMeta({ middleware: ['has-selection'] })

type RepositoryPreflightEvidence = Awaited<ReturnType<ServerApi['preflightRepository']>>

const route = useRoute()
const serverApi = useServerApi()
const toastStore = useToastStore()
const projectId = computed(() => routeParam(route.params.projectId))
const repositoryId = computed(() => routeParam(route.params.repositoryId))
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
const repositoryTitle = computed(() => {
	const config = repository.value?.config
	return config === undefined ? 'Loading Repository…' : `${config.owner}/${config.name}`
})
const referencedSecret = computed(() => {
	const secretId = repository.value?.config.secretId
	return secretId === undefined ? undefined : secretsById.value.get(secretId)
})
const secretLabel = computed(() => {
	const secretId = repository.value?.config.secretId
	if (secretId === undefined) return 'Loading Secret…'
	const secret = referencedSecret.value
	if (secret === undefined) return `${shortId(secretId)} (not found)`
	return `${secret.name} (${shortId(secret.id)})${secret.archived ? ' — archived' : ''}`
})
const secretTone = computed<'muted' | 'error' | 'success'>(() => {
	if (repository.value === null) return 'muted'
	const secret = referencedSecret.value
	if (secret === undefined || secret.archived) return 'error'
	return 'success'
})

const repositoryPageFetches = [
	{ isLoading: isLoadingProject, hasExecuted: hasLoadedProject },
	{ isLoading: isLoadingRepository, hasExecuted: hasLoadedRepository },
	{ isLoading: isLoadingSecrets, hasExecuted: hasLoadedSecrets },
]
const isLoadingRepositoryPage = computed(() => repositoryPageFetches.some(isInitialFetchLoading))
const repositoryPageError = computed(() => projectError.value || repositoryError.value || secretsError.value)
const isRefreshingRepositoryPage = computed(() => repositoryPageFetches.some(isRefreshingFetch))

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

function isInitialFetchLoading(fetch: (typeof repositoryPageFetches)[number]): boolean {
	return fetch.isLoading.value && !fetch.hasExecuted.value
}

function isRefreshingFetch(fetch: (typeof repositoryPageFetches)[number]): boolean {
	return fetch.isLoading.value && fetch.hasExecuted.value
}

function routeParam(value: string | string[]): string {
	return Array.isArray(value) ? (value[0] ?? '') : value
}

function shortId(id: string): string {
	return id.slice(0, 8)
}
</script>
