<template>
	<NuxtLayout name="project" :project-id="projectId">
		<section>
			<div class="flex min-h-11 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
				<span class="text-sz-helper text-dim"
					>{{ repositories.length }} {{ repositories.length === 1 ? 'Repository' : 'Repositories' }}</span
				>
				<NuxtLink
					class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast hover:brightness-110"
					:to="`/projects/${projectId}/repositories/new`">
					New Repository
				</NuxtLink>
			</div>

			<div v-if="isLoadingRepositories && !hasLoadedRepositories" class="border-b border-dimmer px-3 py-4 text-dim">
				Loading Repositories…
			</div>
			<div v-else-if="repositoriesError" class="border-b border-dimmer px-3 py-4 text-error">{{ repositoriesError }}</div>
			<div v-else>
				<p v-if="isRefreshingRepositories" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
					Refreshing Repositories…
				</p>
				<div v-if="repositories.length === 0" class="m-3 border border-dashed border-dimmer p-5">
					<h2 class="m-0 text-sz-subsection font-semibold">No Repositories configured.</h2>
					<p class="m-0 mt-1 text-sz-helper text-dim">Add a GitHub Repository to prepare this Project for Deliveries.</p>
					<NuxtLink
						class="mt-4 inline-flex border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast"
						:to="`/projects/${projectId}/repositories/new`">
						New Repository
					</NuxtLink>
				</div>
				<div v-else>
					<NuxtLink
						v-for="repository in repositories"
						:key="repository.id"
						:to="`/projects/${projectId}/repositories/${repository.id}`"
						class="grid min-h-[58px] grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-b border-dimmer px-3 py-2 text-body hover:bg-card focus-visible:bg-secondary">
						<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">R</span>
						<span class="min-w-0">
							<strong class="block truncate font-semibold">{{ repository.config.owner }}/{{ repository.config.name }}</strong>
							<span class="mt-0.5 block text-sz-helper text-dim">{{ repository.config.provider }}</span>
						</span>
					</NuxtLink>
				</div>
			</div>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useRepositoriesList } from '../../../../composables/portfolio/project/repositories'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const projectId = computed(() => route.params.projectId as string)
const { repositories, isLoadingRepositories, repositoriesError, hasLoadedRepositories, isRefreshingRepositories } =
	useRepositoriesList(projectId)
</script>
