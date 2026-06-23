<template>
	<PortfolioLayout topbar-search-label="Search this Project…">
		<template #main-header>
			<header class="border-b border-dimmer px-3 pt-3">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0">
						<h1
							class="m-0 truncate text-sz-section font-semibold tracking-[-0.01em]"
							:class="isLoadingInitialProject ? 'h-6 w-56 bg-secondary text-transparent' : ''">
							{{ projectTitle }}
						</h1>
						<p v-if="projectSubtitle" class="m-0 mt-1 text-sz-helper text-dim">{{ projectSubtitle }}</p>
					</div>
				</div>
				<nav class="mt-3 flex gap-4" aria-label="Project navigation">
					<NuxtLink
						v-for="{ label, to } in [
							{ label: 'Deliveries', to: `/projects/${projectId}/deliveries` },
							{ label: 'Plans', to: `/projects/${projectId}/plans` },
							{ label: 'Repositories', to: `/projects/${projectId}/repositories` },
						]"
						:key="to"
						:to="to"
						class="border-b-2 px-0 pb-2 text-sz-helper font-semibold no-underline"
						:class="route.path.startsWith(to) ? 'border-primary text-body' : 'text-dim hover:text-body border-transparent'">
						{{ label }}
					</NuxtLink>
				</nav>
			</header>
		</template>

		<section v-if="isLoadingInitialProject" class="border-b border-dimmer px-3 py-4 text-dim">Loading Project…</section>
		<section v-else-if="projectError" class="border-b border-dimmer px-3 py-4 text-error">{{ projectError }}</section>
		<slot v-else />

		<template v-if="$slots.right && project" #right>
			<slot name="right" />
		</template>
	</PortfolioLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { usePortfolioProjectQuery } from '../composables/portfolio-resource-queries'
import { useServerApi } from '../composables/useServerApi'
import { formatDate } from '../utils/time'
import PortfolioLayout from './portfolio.vue'

const props = defineProps<{
	projectId: string
}>()

const route = useRoute()
const serverApi = useServerApi()
const {
	data: project,
	isLoading: isLoadingProject,
	error: projectError,
	hasExecuted: hasLoadedProject,
} = usePortfolioProjectQuery(
	serverApi,
	computed(() => props.projectId),
)

const isLoadingInitialProject = computed(() => isLoadingProject.value && !hasLoadedProject.value)
const projectTitle = computed(() => {
	if (project.value !== null) return project.value.title
	return projectError.value ? 'Project unavailable' : 'Loading Project…'
})
const projectSubtitle = computed(() => {
	if (project.value === null) return ''
	return `Source-control Project · Created ${formatDate(project.value.created.at)}`
})
</script>
