<template>
	<NuxtLayout
		name="project"
		:project-id="projectId"
		:project-title="project?.title ?? 'Loading Project…'"
		:project-subtitle="projectSubtitle">
		<section>
			<div v-if="isLoadingProject && !hasLoadedProject" class="border-b border-dimmer px-3 py-4 text-dim">Loading Project…</div>
			<div v-else-if="projectError" class="border-b border-dimmer px-3 py-4 text-error">{{ projectError }}</div>
			<div v-else-if="project" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Deliveries yet.</h2>
				<p class="m-0 mt-1 max-w-[680px] text-sz-helper leading-5 text-dim">
					Deliveries are created when an accepted Plan Output materializes executable work for this Project. Plan creation is not
					available in this slice.
				</p>
			</div>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { usePortfolioProjectQuery } from '../../../../composables/portfolio-resource-queries'
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

const projectSubtitle = computed(() => {
	if (project.value === null) return 'Source-control Project'
	return `Source-control Project · Created ${formatDate(project.value.created.at)}`
})
</script>
