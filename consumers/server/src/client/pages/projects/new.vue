<template>
	<SelectedPortfolioShell>
		<UiHero>
			<UiText as="p" tone="primary" class="font-bold uppercase tracking-[0.16em]">New Project</UiText>
			<UiHeading as="h1" size="hero">Create a Project.</UiHeading>
			<UiText size="lede" tone="muted"
				>Start with a title-only source-control Project, then add Repositories from Project details.</UiText
			>
		</UiHero>

		<UiCard>
			<form class="grid max-w-[520px] gap-4" @submit.prevent="createProject()">
				<label class="grid gap-2 font-bold text-dim">
					Project title
					<UiInput
						v-model="projectCreationForm.title"
						required
						placeholder="Delivery Ops"
						:invalid="!!projectCreationForm.errors.title" />
				</label>
				<UiText v-if="projectCreationForm.errors.title" tone="error" size="helper">
					{{ projectCreationForm.errors.title }}
				</UiText>
				<div class="flex flex-wrap items-center gap-3">
					<UiButton type="submit" :loading="isCreatingProject" :disabled="!projectCreationForm.valid">Create Project</UiButton>
					<NuxtLink
						class="inline-flex items-center justify-center rounded-pill border border-dimmer bg-secondary px-5 py-3 font-extrabold text-secondary-contrast no-underline transition hover:border-primary"
						to="/projects">
						Back to Projects
					</NuxtLink>
				</div>
				<UiText v-if="createProjectError" tone="error">{{ createProjectError }}</UiText>
			</form>
		</UiCard>
	</SelectedPortfolioShell>
</template>

<script setup lang="ts">
import SelectedPortfolioShell from '../../components/SelectedPortfolioShell.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiCard from '../../components/ui/UiCard.vue'
import UiHeading from '../../components/ui/UiHeading.vue'
import UiHero from '../../components/ui/UiHero.vue'
import UiInput from '../../components/ui/UiInput.vue'
import UiText from '../../components/ui/UiText.vue'
import { useApiAction } from '../../composables/action-state'
import { useQueryCache } from '../../composables/query-cache'
import { useSelectedPortfolio } from '../../composables/selected-portfolio'
import { useServerApi } from '../../composables/useServerApi'
import { ProjectCreationFormFactory } from '../../forms/project'
import { useToastStore } from '../../stores/toasts'

definePageMeta({ middleware: ['has-selection'] })

const selectedPortfolio = useSelectedPortfolio()
const serverApi = useServerApi()
const toastStore = useToastStore()
const queryCache = useQueryCache()
const { queryKeys } = queryCache
const projectCreationForm = new ProjectCreationFormFactory()

const {
	isLoading: isCreatingProject,
	error: createProjectError,
	execute: createProject,
} = useApiAction(async () => {
	const project = await serverApi.createProject(projectCreationForm.toModel())
	queryCache.invalidate(queryKeys.portfolio.projects(selectedPortfolio.value.portfolio.id), { exact: true })
	toastStore.success({ title: 'Project created.', body: project.title })
	await navigateTo(`/projects/${project.id}`)
})
</script>
