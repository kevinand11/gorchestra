<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 pt-3 pb-4">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Projects</h1>
					<p class="m-0 mt-1 text-sz-helper text-dim">Create and inspect Projects in the selected Portfolio.</p>
				</div>
				<NuxtLink
					class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast no-underline hover:brightness-110"
					to="/projects/new">
					New Project
				</NuxtLink>
			</div>
		</header>

		<div class="flex min-h-11 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
			<div class="flex overflow-hidden border border-dimmer">
				<NuxtLink
					v-for="(tab, index) in projectTabs"
					:key="tab.value"
					:to="projectTabLocation(tab.value)"
					class="px-2 py-1 text-sz-helper no-underline"
					:class="[projectFilterPillClass(tab.value), index === projectTabs.length - 1 ? '' : 'border-r border-dimmer']">
					{{ tab.shortLabel }}
				</NuxtLink>
			</div>
			<span class="text-sz-helper text-dim">
				{{ visibleProjects.length }} {{ visibleProjects.length === 1 ? 'Project' : 'Projects' }}
			</span>
		</div>

		<section>
			<div v-if="isLoadingProjects && !hasLoadedProjects" class="border-b border-dimmer px-3 py-4 text-dim">Loading Projects…</div>
			<div v-else-if="projectsError" class="border-b border-dimmer px-3 py-4 text-error">{{ projectsError }}</div>
			<div v-else-if="projects.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Projects yet.</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">
					Create the first Project in this Portfolio to attach Repositories and prepare delivery work.
				</p>
				<NuxtLink
					class="mt-4 inline-flex border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast no-underline"
					to="/projects/new">
					Create your first Project
				</NuxtLink>
			</div>
			<div v-else-if="visibleProjects.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Projects match {{ currentProjectTabLabel }}.</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">Change the filter to inspect another Project slice.</p>
				<NuxtLink
					class="mt-4 inline-flex border border-dimmer bg-secondary px-3 py-1.5 text-sz-helper font-semibold text-secondary-contrast no-underline"
					:to="projectTabLocation('all')">
					Show all Projects
				</NuxtLink>
			</div>
			<div v-else>
				<NuxtLink
					v-for="project in visibleProjects"
					:key="project.id"
					:to="`/projects/${project.id}`"
					class="grid min-h-[58px] grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-b border-dimmer px-3 py-2 text-body no-underline hover:bg-card focus-visible:bg-secondary lg:grid-cols-[24px_minmax(0,1fr)_150px]">
					<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">P</span>
					<span class="min-w-0">
						<strong class="block truncate font-semibold">{{ project.title }}</strong>
						<span class="mt-0.5 flex flex-wrap gap-2 text-sz-helper text-dim">
							<span>{{ sourceLabel(project) }}</span>
							<span>{{ repositorySummary(project) }}</span>
						</span>
					</span>
					<span class="hidden justify-self-start lg:inline-flex" :class="projectStatusClass(project)">
						<span class="size-2 rounded-full" :class="project.source.repositories.length === 0 ? 'bg-primary' : 'bg-success'" />
						{{ project.source.repositories.length === 0 ? 'needs Repository' : 'ready' }}
					</span>
				</NuxtLink>
			</div>
			<p v-if="isLoadingProjects && hasLoadedProjects" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Projects…
			</p>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { useFetchAction } from '../../composables/action-state'
import { useQueryCache } from '../../composables/query-cache'
import { useSelectedPortfolio } from '../../composables/selected-portfolio'
import { useServerApi, type ServerApi } from '../../composables/useServerApi'

definePageMeta({ middleware: ['has-selection'] })

type ListedProject = Awaited<ReturnType<ServerApi['listProjects']>>[number]
type ProjectTab = 'all' | 'source-control' | 'needs-setup'

const projectTabs: Array<{ value: ProjectTab; label: string; shortLabel: string }> = [
	{ value: 'all', label: 'All Projects', shortLabel: 'All' },
	{ value: 'source-control', label: 'Source control', shortLabel: 'Source control' },
	{ value: 'needs-setup', label: 'Needs setup', shortLabel: 'Needs setup' },
]

const route = useRoute()
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

const currentProjectTab = computed(() => parseProjectTab(route.query.tab))
const currentProjectTabLabel = computed(() => projectTabs.find((tab) => tab.value === currentProjectTab.value)?.label ?? 'All Projects')
const visibleProjects = computed(() => projects.value.filter((project) => matchesProjectTab(project, currentProjectTab.value)))

function projectTabLocation(tab: ProjectTab) {
	return { path: route.path, query: { ...route.query, tab } }
}

function parseProjectTab(value: unknown): ProjectTab {
	const tab = Array.isArray(value) ? value[0] : value
	return projectTabs.some((option) => option.value === tab) ? (tab as ProjectTab) : 'all'
}

function matchesProjectTab(project: ListedProject, tab: ProjectTab): boolean {
	if (tab === 'needs-setup') return project.source.repositories.length === 0
	if (tab === 'source-control') return project.source.type === 'source-control'
	return true
}

function projectFilterPillClass(tab: ProjectTab): string {
	return currentProjectTab.value === tab ? 'bg-card font-semibold text-body' : 'text-dim hover:bg-secondary hover:text-body'
}

function sourceLabel(project: ListedProject): string {
	return project.source.type === 'source-control' ? 'source-control' : project.source.type
}

function repositorySummary(project: ListedProject): string {
	const count = project.source.repositories.length
	if (count === 0) return 'No Repositories configured'
	if (count === 1) {
		const repository = project.source.repositories[0]!
		return `${repository.config.owner}/${repository.config.name}`
	}
	return `${count} Repositories configured`
}

function projectStatusClass(project: ListedProject): string {
	return project.source.repositories.length === 0
		? 'items-center gap-1 border border-primary/50 bg-primary/10 px-2 py-0.5 text-sz-micro font-semibold text-primary'
		: 'items-center gap-1 border border-success/50 bg-success/10 px-2 py-0.5 text-sz-micro font-semibold text-success'
}
</script>
