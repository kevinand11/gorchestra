<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">New Project</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Start with a source-control Project, then add Repositories from Project details.</p>
		</header>

		<section class="px-3 py-3">
			<UiForm class="max-w-[520px]" @submit.prevent="createProject()">
				<UiFormGroup label="Project title" for-id="project-title" :error="projectCreationForm.errors.title">
					<UiInput
						id="project-title"
						v-model="projectCreationForm.title"
						required
						placeholder="Delivery Ops"
						:invalid="!!projectCreationForm.errors.title" />
				</UiFormGroup>
				<div class="flex flex-wrap items-center gap-2">
					<UiButton type="submit" :loading="isCreatingProject" :disabled="!projectCreationForm.valid">Create Project</UiButton>
				</div>
				<UiText v-if="createProjectError" tone="error">{{ createProjectError }}</UiText>
			</UiForm>
		</section>

		<template #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Guidance</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">Use the product name</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					Choose a title people will recognize in Repository, Delivery, and review workflows.
				</p>
			</div>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">What gets created</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">A Project shell</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					The Project starts ready for source-control setup. Repositories are connected next from Project details.
				</p>
			</div>
			<div class="px-3 py-3">
				<strong class="block font-semibold">Portfolio context</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">This Project will belong to {{ portfolio.displayName }}.</p>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import UiButton from '../../components/ui/UiButton.vue'
import UiForm from '../../components/ui/UiForm.vue'
import UiFormGroup from '../../components/ui/UiFormGroup.vue'
import UiInput from '../../components/ui/UiInput.vue'
import UiText from '../../components/ui/UiText.vue'
import { useApiAction } from '../../composables/action-state'
import { useQueryCache } from '../../composables/query-cache'
import { useSelectedPortfolio } from '../../composables/selected-portfolio'
import { useServerApi } from '../../composables/useServerApi'
import { ProjectCreationFormDraft } from '../../forms/project'
import { useToasts } from '../../composables/toasts'

definePageMeta({ middleware: ['has-selection'] })

const { portfolio } = useSelectedPortfolio()
const serverApi = useServerApi()
const toasts = useToasts()
const queryCache = useQueryCache()
const { queryKeys } = queryCache
const projectCreationForm = new ProjectCreationFormDraft()

const {
	isLoading: isCreatingProject,
	error: createProjectError,
	execute: createProject,
} = useApiAction(async () => {
	const project = await serverApi.createProject(projectCreationForm.toModel())
	queryCache.invalidate(queryKeys.portfolio.projects(portfolio.value.id), { exact: true })
	toasts.success({ title: 'Project created.', body: project.title })
	await navigateTo(`/projects/${project.id}`)
})
</script>
