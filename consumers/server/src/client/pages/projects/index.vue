<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 pt-3 pb-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Projects</h1>
					<p class="m-0 mt-1 text-sz-helper text-dim">Create and inspect Projects in the selected Portfolio.</p>
				</div>
				<NuxtLink
					class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast hover:brightness-110"
					to="/projects/new">
					New Project
				</NuxtLink>
			</div>
		</header>

		<section>
			<div v-if="isLoadingProjects && !hasLoadedProjects" class="border-b border-dimmer px-3 py-4 text-dim">Loading Projects…</div>
			<div v-else-if="projectsError" class="border-b border-dimmer px-3 py-4 text-error">{{ projectsError }}</div>
			<div v-else-if="projects.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Projects yet.</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">
					Create the first Project in this Portfolio to attach Repositories and prepare delivery work.
				</p>
				<NuxtLink
					class="mt-4 inline-flex border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast"
					to="/projects/new">
					Create your first Project
				</NuxtLink>
			</div>
			<div v-else>
				<NuxtLink
					v-for="project in projects"
					:key="project.id"
					:to="`/projects/${project.id}`"
					class="grid min-h-[58px] grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-b border-dimmer px-3 py-2 text-body hover:bg-card focus-visible:bg-secondary">
					<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">P</span>
					<span class="min-w-0">
						<strong class="block truncate font-semibold">{{ project.title }}</strong>
						<span class="mt-0.5 block text-sz-helper text-dim">{{ project.source.type }}</span>
					</span>
				</NuxtLink>
			</div>
			<p v-if="isRefreshingProjects" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">Refreshing Projects…</p>
		</section>

		<template #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Setup order</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Create a Project first, then attach Repositories from that Project's Repositories surface.
					</p>
				</section>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Project work</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Plans and Deliveries live under a Project so planning context, repositories, and delivery history stay together.
					</p>
				</section>
				<section class="px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Configuration</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Project-specific configuration is handled inside each Project. Reusable run settings live in Agent Run Profiles.
					</p>
					<NuxtLink
						class="mt-2 inline-flex text-sz-helper font-semibold text-primary hover:brightness-110"
						to="/agent-run-profiles">
						Open Agent Run Profiles
					</NuxtLink>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { useProjectsList } from '../../composables/portfolio/projects'

definePageMeta({ middleware: ['has-selection'] })

const { projects, isLoadingProjects, projectsError, hasLoadedProjects, isRefreshingProjects } = useProjectsList()
</script>
