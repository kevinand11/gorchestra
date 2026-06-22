<template>
	<SelectedPortfolioShell>
		<UiHero>
			<UiText as="p" tone="primary" class="font-bold uppercase tracking-[0.16em]">Selected Portfolio</UiText>
			<UiHeading as="h1" size="hero">Projects</UiHeading>
			<UiText size="lede" tone="muted">Create and inspect Projects in the selected Portfolio.</UiText>
		</UiHero>

		<section class="grid gap-5">
			<UiCard tone="accent">
				<UiHeading as="h2" size="section">
					{{ selectedPortfolio.workspace.displayName }} / {{ selectedPortfolio.portfolio.displayName }}
				</UiHeading>
				<UiText tone="muted">Portfolio registry id: {{ selectedPortfolio.portfolio.id }}</UiText>
				<UiText tone="muted">Core storage namespace: {{ selectedPortfolio.portfolio.coreStorageNamespace }}</UiText>
			</UiCard>

			<UiCard>
				<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
					<UiHeading as="h2" size="section">Projects</UiHeading>
					<NuxtLink
						class="inline-flex items-center justify-center rounded-pill bg-primary px-5 py-3 font-extrabold text-primary-contrast no-underline transition hover:brightness-110"
						to="/projects/new">
						New Project
					</NuxtLink>
				</div>
				<UiText v-if="isLoadingProjects && !hasLoadedProjects" tone="muted">Loading Projects…</UiText>
				<UiText v-else-if="projectsError" tone="error">{{ projectsError }}</UiText>
				<div v-else-if="projects.length === 0" class="grid gap-3">
					<UiText tone="muted">No Projects yet.</UiText>
					<NuxtLink
						class="inline-flex w-fit items-center justify-center rounded-pill bg-primary px-5 py-3 font-extrabold text-primary-contrast no-underline transition hover:brightness-110"
						to="/projects/new">
						Create your first Project
					</NuxtLink>
				</div>
				<ul v-else class="grid list-none gap-3 p-0">
					<li
						v-for="project in projects"
						:key="project.id"
						class="flex flex-wrap items-center justify-between gap-3 rounded-list-item border border-dimmer bg-dimmer p-3.5">
						<div>
							<strong>{{ project.title }}</strong>
							<UiText as="span" tone="muted">Project id: {{ project.id }}</UiText>
							<UiText as="span" tone="muted">Source: {{ project.source.type }}</UiText>
							<UiText v-if="project.source.repositories.length === 0" as="span" tone="muted">
								No Repositories configured.
							</UiText>
							<UiText v-for="repository in project.source.repositories" :key="repository.id" as="span" tone="muted">
								{{ repository.config.provider }}: {{ repository.config.owner }}/{{ repository.config.name }}
							</UiText>
						</div>
						<NuxtLink
							class="inline-flex items-center justify-center rounded-pill border border-dimmer bg-secondary px-4 py-2.5 font-extrabold text-secondary-contrast no-underline transition hover:border-primary"
							:to="`/projects/${project.id}`">
							Open
						</NuxtLink>
					</li>
				</ul>
				<UiText v-if="isLoadingProjects && hasLoadedProjects" tone="muted" size="helper">Refreshing Projects…</UiText>
			</UiCard>

			<UiCard>
				<UiHeading as="h2" size="section" class="mb-2">Project routes</UiHeading>
				<UiText tone="muted">This Projects route loads selected Portfolio Projects through an explicit Core query boundary.</UiText>
			</UiCard>
		</section>
	</SelectedPortfolioShell>
</template>

<script setup lang="ts">
import SelectedPortfolioShell from '../../components/SelectedPortfolioShell.vue'
import UiCard from '../../components/ui/UiCard.vue'
import UiHeading from '../../components/ui/UiHeading.vue'
import UiHero from '../../components/ui/UiHero.vue'
import UiText from '../../components/ui/UiText.vue'
import { useFetchAction } from '../../composables/action-state'
import { useQueryCache } from '../../composables/query-cache'
import { useSelectedPortfolio } from '../../composables/selected-portfolio'
import { useServerApi, type ServerApi } from '../../composables/useServerApi'

definePageMeta({ middleware: ['has-selection'] })

type ListedProject = Awaited<ReturnType<ServerApi['listProjects']>>[number]

const selectedPortfolio = useSelectedPortfolio()
const serverApi = useServerApi()
const { queryKeys } = useQueryCache()
const portfolioId = computed(() => selectedPortfolio.value.portfolio.id)
const {
	data: projects,
	isLoading: isLoadingProjects,
	error: projectsError,
	hasExecuted: hasLoadedProjects,
} = useFetchAction(() => serverApi.listProjects(), {
	queryKey: queryKeys.portfolio.projects(portfolioId.value),
	initialData: [] as ListedProject[],
})
</script>
