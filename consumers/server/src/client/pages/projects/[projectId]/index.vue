<template>
	<SelectedPortfolioShell>
		<UiHero>
			<UiText as="p" tone="primary" class="font-bold uppercase tracking-[0.16em]">Project Details</UiText>
			<UiHeading as="h1" size="hero">{{ project?.title ?? 'Loading Project…' }}</UiHeading>
			<UiText size="lede" tone="muted">Configure the source-control Repositories this Project can orchestrate.</UiText>
		</UiHero>

		<UiCard>
			<UiText v-if="isLoadingProjectDetails" tone="muted">Loading Project…</UiText>
			<UiText v-else-if="projectDetailsError" tone="error">{{ projectDetailsError }}</UiText>
			<div v-else-if="project" class="grid gap-5">
				<UiText v-if="isRefreshingProjectDetails" tone="muted" size="helper">Refreshing Project details…</UiText>
				<div class="grid gap-2">
					<UiHeading as="h2" size="section">{{ project.title }}</UiHeading>
					<UiText tone="muted">Project id: {{ project.id }}</UiText>
					<UiText tone="muted">Source: {{ project.source.type }}</UiText>
					<UiText tone="muted">Created: {{ project.created.at }}</UiText>
				</div>

				<div class="grid gap-3">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiHeading as="h2" size="section">Repositories</UiHeading>
						<NuxtLink
							class="inline-flex items-center justify-center rounded-pill bg-primary px-5 py-3 font-extrabold text-primary-contrast no-underline transition hover:brightness-110"
							:to="`/projects/${project.id}/repositories/new`">
							New Repository
						</NuxtLink>
					</div>
					<UiText v-if="project.source.repositories.length === 0" tone="muted">
						No Repositories configured. Add a GitHub Repository to prepare this Project for Deliveries.
					</UiText>
					<ul v-else class="grid list-none gap-3 p-0">
						<li
							v-for="repository in project.source.repositories"
							:key="repository.id"
							class="flex flex-wrap items-center justify-between gap-3 rounded-list-item border border-dimmer bg-dimmer p-3.5">
							<div class="grid gap-1">
								<strong>{{ repository.config.owner }}/{{ repository.config.name }}</strong>
								<UiText as="span" tone="muted">Repository id: {{ repository.id }}</UiText>
								<UiText as="span" tone="muted">Provider: {{ repository.config.provider }}</UiText>
								<UiText as="span" :tone="secretTone(repository.config.secretId)">
									Secret: {{ secretLabel(repository.config.secretId) }}
								</UiText>
							</div>
							<NuxtLink
								class="inline-flex items-center justify-center rounded-pill border border-dimmer bg-secondary px-4 py-2.5 font-extrabold text-secondary-contrast no-underline transition hover:border-primary"
								:to="`/projects/${project.id}/repositories/${repository.id}`">
								Details
							</NuxtLink>
						</li>
					</ul>
				</div>

				<NuxtLink
					class="inline-flex w-fit items-center justify-center rounded-pill border border-dimmer bg-secondary px-5 py-3 font-extrabold text-secondary-contrast no-underline transition hover:border-primary"
					to="/projects">
					Back to Projects
				</NuxtLink>
			</div>
		</UiCard>
	</SelectedPortfolioShell>
</template>

<script setup lang="ts">
import SelectedPortfolioShell from '../../../components/SelectedPortfolioShell.vue'
import UiCard from '../../../components/ui/UiCard.vue'
import UiHeading from '../../../components/ui/UiHeading.vue'
import UiHero from '../../../components/ui/UiHero.vue'
import UiText from '../../../components/ui/UiText.vue'
import { usePortfolioProjectQuery, usePortfolioSecretsQuery } from '../../../composables/portfolio-resource-queries'
import { useServerApi } from '../../../composables/useServerApi'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const serverApi = useServerApi()
const projectId = computed(() => routeParam(route.params.projectId))
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

const secretsById = computed(() => new Map(secrets.value.map((secret) => [secret.id, secret])))

const isLoadingProjectDetails = computed(
	() => (isLoadingProject.value && !hasLoadedProject.value) || (isLoadingSecrets.value && !hasLoadedSecrets.value),
)
const projectDetailsError = computed(() => projectError.value || secretsError.value)
const isRefreshingProjectDetails = computed(
	() => (isLoadingProject.value && hasLoadedProject.value) || (isLoadingSecrets.value && hasLoadedSecrets.value),
)

function routeParam(value: string | string[]): string {
	return Array.isArray(value) ? (value[0] ?? '') : value
}

function secretLabel(secretId: string): string {
	const secret = secretsById.value.get(secretId)
	if (secret === undefined) return `${shortId(secretId)} (not found)`
	return `${secret.name} (${shortId(secret.id)})${secret.archived ? ' — archived' : ''}`
}

function secretTone(secretId: string): 'muted' | 'error' | 'success' {
	const secret = secretsById.value.get(secretId)
	if (secret === undefined || secret.archived) return 'error'
	return 'success'
}

function shortId(id: string): string {
	return id.slice(0, 8)
}
</script>
