<template>
	<UiShell>
		<UiHero>
			<UiText as="p" tone="primary" class="font-bold uppercase tracking-[0.16em]">Selected Portfolio</UiText>
			<UiHeading as="h1" size="hero">Ready for Core work.</UiHeading>
			<UiText size="lede" tone="muted">Project, Plan, and Delivery views will land after Core read routes are added.</UiText>
		</UiHero>

		<section v-if="selection?.selected" class="grid gap-5">
			<UiCard tone="accent">
				<UiHeading as="h2" size="section">{{ selection.workspace.displayName }} / {{ selection.portfolio.displayName }}</UiHeading>
				<UiText tone="muted">Portfolio registry id: {{ selection.portfolio.id }}</UiText>
				<UiText tone="muted">Core storage namespace: {{ selection.portfolio.coreStorageNamespace }}</UiText>
			</UiCard>

			<UiCard>
				<UiHeading as="h2" size="section" class="mb-3">Projects</UiHeading>
				<UiText v-if="isLoadingProjects && !hasLoadedProjects" tone="muted">Loading Projects…</UiText>
				<UiText v-else-if="projectsError" tone="error">{{ projectsError }}</UiText>
				<UiText v-else-if="projects.length === 0" tone="muted">No Projects yet.</UiText>
				<ul v-else class="grid list-none gap-3 p-0">
					<li
						v-for="project in projects"
						:key="project.id"
						class="flex items-center justify-between gap-3 rounded-list-item border border-dimmer bg-dimmer p-3.5">
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
					</li>
				</ul>
			</UiCard>

			<UiCard>
				<UiHeading as="h2" size="section" class="mb-2">Portfolio actions</UiHeading>
				<UiText tone="muted">This app route loads selected Portfolio Projects through an explicit Core query boundary.</UiText>
				<div class="mt-4 flex flex-wrap items-start gap-3">
					<NuxtLink
						class="inline-flex items-center justify-center rounded-pill bg-primary px-5 py-3 font-extrabold text-primary-contrast no-underline transition hover:brightness-110"
						to="/select">
						Change selection
					</NuxtLink>
					<div class="grid gap-2">
						<UiButton type="button" variant="secondary" :loading="isLoggingOut" @click="logout()">Sign out</UiButton>
						<UiText v-if="logoutError" tone="error">{{ logoutError }}</UiText>
					</div>
				</div>
			</UiCard>
		</section>

		<UiCard v-else>
			<UiHeading as="h2" size="section">Checking selection…</UiHeading>
			<UiText tone="muted">The app route requires a selected Workspace and Portfolio.</UiText>
		</UiCard>
	</UiShell>
</template>

<script setup lang="ts">
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiHeading from '../components/ui/UiHeading.vue'
import UiHero from '../components/ui/UiHero.vue'
import UiShell from '../components/ui/UiShell.vue'
import UiText from '../components/ui/UiText.vue'
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
