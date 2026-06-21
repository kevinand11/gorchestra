<template>
	<main class="shell">
		<section class="hero">
			<p class="eyebrow">Selected Portfolio</p>
			<h1>Ready for Core work.</h1>
			<p>Project, Plan, and Delivery views will land after Core read routes are added.</p>
		</section>

		<section v-if="selection?.selected" class="grid">
			<article class="card accent">
				<h2>{{ selection.workspace.displayName }} / {{ selection.portfolio.displayName }}</h2>
				<p class="muted">Portfolio registry id: {{ selection.portfolio.id }}</p>
				<p class="muted">Core storage namespace: {{ selection.portfolio.coreStorageNamespace }}</p>
			</article>

			<article class="card">
				<h2>Projects</h2>
				<p v-if="isLoadingProjects && !hasLoadedProjects" class="muted">Loading Projects…</p>
				<p v-else-if="projectsError" class="error">{{ projectsError }}</p>
				<p v-else-if="projects.length === 0" class="muted">No Projects yet.</p>
				<ul v-else class="portfolio-list">
					<li v-for="project in projects" :key="project.id">
						<div>
							<strong>{{ project.title }}</strong>
							<span>Project id: {{ project.id }}</span>
							<span>Source: {{ project.source.type }}</span>
							<span v-if="project.source.repositories.length === 0">No Repositories configured.</span>
							<span v-for="repository in project.source.repositories" :key="repository.id">
								{{ repository.config.provider }}: {{ repository.config.owner }}/{{ repository.config.name }}
							</span>
						</div>
					</li>
				</ul>
			</article>

			<article class="card">
				<h2>Portfolio actions</h2>
				<p>This app route loads selected Portfolio Projects through an explicit Core query boundary.</p>
				<div class="actions">
					<NuxtLink class="button-link" to="/select">Change selection</NuxtLink>
					<button type="button" class="secondary" :disabled="isLoggingOut" @click="logout()">Sign out</button>
				</div>
				<p v-if="logoutError" class="error">{{ logoutError }}</p>
			</article>
		</section>

		<section v-else class="card">
			<h2>Checking selection…</h2>
			<p class="muted">The app route requires a selected Workspace and Portfolio.</p>
		</section>
	</main>
</template>

<script setup lang="ts">
import { useApiAction, useFetchAction } from '../composables/action-state'
import { useServerApi, type ServerApi } from '../composables/useServerApi'
import { useSessionStore } from '../stores/session'

definePageMeta({ middleware: ['has-selection'] })

type ListedProject = Awaited<ReturnType<ServerApi['listProjects']>>[number]

const sessionStore = useSessionStore()
const serverApi = useServerApi()

const selection = computed(() => sessionStore.selection)
const projects = ref<ListedProject[]>([])
const {
	isLoading: isLoadingProjects,
	error: projectsError,
	hasExecuted: hasLoadedProjects,
} = useFetchAction(
	async () => {
		projects.value = await serverApi.listProjects()
	},
	{ dedupeKey: 'selected-portfolio-projects' },
)
const {
	isLoading: isLoggingOut,
	error: logoutError,
	execute: logout,
} = useApiAction(async () => {
	await sessionStore.logout()
	await navigateTo('/sign-in')
})
</script>
