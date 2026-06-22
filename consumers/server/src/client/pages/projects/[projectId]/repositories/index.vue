<template>
	<NuxtLayout
		name="project"
		:project-id="projectId"
		:project-title="project?.title ?? 'Loading Project…'"
		:project-subtitle="projectSubtitle">
		<section>
			<div class="flex min-h-11 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
				<div class="flex overflow-hidden border border-dimmer">
					<span class="border-r border-dimmer bg-card px-2 py-1 text-sz-helper font-semibold text-body">All</span>
					<span class="border-r border-dimmer px-2 py-1 text-sz-helper text-dim">Ready</span>
					<span class="px-2 py-1 text-sz-helper text-dim">Needs setup</span>
				</div>
				<NuxtLink
					v-if="project"
					class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast no-underline hover:brightness-110"
					:to="`/projects/${project.id}/repositories/new`">
					New Repository
				</NuxtLink>
			</div>

			<div v-if="isLoadingProjectDetails" class="border-b border-dimmer px-3 py-4 text-dim">Loading Project…</div>
			<div v-else-if="projectDetailsError" class="border-b border-dimmer px-3 py-4 text-error">{{ projectDetailsError }}</div>
			<div v-else-if="project">
				<p v-if="isRefreshingProjectDetails" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
					Refreshing Project details…
				</p>
				<div v-if="project.source.repositories.length === 0" class="m-3 border border-dashed border-dimmer p-5">
					<h2 class="m-0 text-sz-subsection font-semibold">No Repositories configured.</h2>
					<p class="m-0 mt-1 text-sz-helper text-dim">Add a GitHub Repository to prepare this Project for Deliveries.</p>
					<NuxtLink
						class="mt-4 inline-flex border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast no-underline"
						:to="`/projects/${project.id}/repositories/new`">
						New Repository
					</NuxtLink>
				</div>
				<div v-else>
					<NuxtLink
						v-for="repository in project.source.repositories"
						:key="repository.id"
						:to="`/projects/${project.id}/repositories/${repository.id}`"
						class="grid min-h-[58px] grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-b border-dimmer px-3 py-2 text-body no-underline hover:bg-card focus-visible:bg-secondary lg:grid-cols-[24px_minmax(0,1fr)_126px]">
						<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">R</span>
						<span class="min-w-0">
							<strong class="block truncate font-semibold">{{ repository.config.owner }}/{{ repository.config.name }}</strong>
							<span class="mt-0.5 flex flex-wrap gap-2 text-sz-helper text-dim">
								<span>{{ repository.config.provider }}</span>
								<span>Secret: {{ secretLabel(repository.config.secretId) }}</span>
							</span>
						</span>
						<span class="hidden justify-self-start lg:inline-flex items-center gap-1 border border-current/50 bg-current/10 px-2 py-0.5 text-sz-micro font-semibold" :class="repositoryStatusClass(repository.config.secretId)">
							<span class="size-2 rounded-full bg-current" />
							{{ repositoryStatusLabel(repository.config.secretId) }}
						</span>
					</NuxtLink>
				</div>
			</div>
		</section>

		<template v-if="repositoryIssues.length > 0" #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Needs attention</div>
			<NuxtLink
				v-for="issue in repositoryIssues"
				:key="issue.repository.id"
				:to="`/projects/${project?.id}/repositories/${issue.repository.id}`"
				class="grid grid-cols-[14px_minmax(0,1fr)_auto] gap-2 border-b border-dimmer px-3 py-2 text-body no-underline hover:bg-card">
				<span class="mt-1.5 size-2 rounded-full bg-primary" />
				<span class="min-w-0"
					><strong class="block truncate font-semibold"
						>{{ issue.repository.config.owner }}/{{ issue.repository.config.name }}</strong
					><span class="block text-sz-helper text-dim">{{ issue.label }}</span></span
				>
				<span class="border border-primary/50 bg-primary/10 px-1.5 py-0.5 text-sz-micro text-primary">secret</span>
			</NuxtLink>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { usePortfolioProjectQuery, usePortfolioSecretsQuery } from '../../../../composables/portfolio-resource-queries'
import { useServerApi } from '../../../../composables/useServerApi'
import { formatDate } from '../../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const serverApi = useServerApi()
const projectId = computed(() => route.params.projectId as string)
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
const projectSubtitle = computed(() => {
	if (project.value === null) return 'Source-control Project'
	return `Source-control Project · Created ${formatDate(project.value.created.at)}`
})
const repositoryIssues = computed(() => {
	if (project.value === null) return []
	return project.value.source.repositories.flatMap((repository) => {
		const secret = secretsById.value.get(repository.config.secretId)
		if (secret === undefined) return [{ repository, label: 'Secret not found' }]
		return secret.archived ? [{ repository, label: 'Secret archived' }] : []
	})
})

const isLoadingProjectDetails = computed(
	() => (isLoadingProject.value && !hasLoadedProject.value) || (isLoadingSecrets.value && !hasLoadedSecrets.value),
)
const projectDetailsError = computed(() => projectError.value || secretsError.value)
const isRefreshingProjectDetails = computed(
	() => (isLoadingProject.value && hasLoadedProject.value) || (isLoadingSecrets.value && hasLoadedSecrets.value),
)

function secretLabel(secretId: string): string {
	const secret = secretsById.value.get(secretId)
	if (secret === undefined) return 'not found'
	return secret.archived ? `${secret.name} — archived` : secret.name
}

function repositoryStatusLabel(secretId: string): string {
	const secret = secretsById.value.get(secretId)
	if (secret === undefined) return 'secret missing'
	return secret.archived ? 'secret archived' : 'ready'
}

function repositoryStatusClass(secretId: string): string {
	const secret = secretsById.value.get(secretId)
	return secret === undefined || secret.archived
		? 'text-primary'
		: 'text-success'
}
</script>
