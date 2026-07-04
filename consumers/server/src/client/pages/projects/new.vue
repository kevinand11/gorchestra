<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">New Project</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Start with a source-control Project, then add Repositories from Project details.</p>
		</header>

		<section class="px-3 py-3">
			<UiForm @submit.prevent="createProject()">
				<UiFormGroup label="Project title" for-id="project-title" :error="projectCreationForm.errors.title">
					<UiInput
						id="project-title"
						v-model="projectCreationForm.title"
						required
						placeholder="Delivery Ops"
						:invalid="!!projectCreationForm.errors.title" />
				</UiFormGroup>
				<UiFormGroup
					label="Execution Agent Run Profile"
					for-id="project-execution-profile"
					:error="projectCreationForm.errors.executionAgentRunProfileId">
					<UiSelect
						id="project-execution-profile"
						v-model="projectCreationForm.executionAgentRunProfileId"
						:options="activeAgentRunProfileOptions"
						:invalid="!!projectCreationForm.errors.executionAgentRunProfileId" />
				</UiFormGroup>
				<UiFormGroup
					label="Revision execution profile"
					for-id="project-revision-execution-profile"
					:error="projectCreationForm.errors.revisionExecutionAgentRunProfileId">
					<UiSelect
						id="project-revision-execution-profile"
						v-model="projectCreationForm.revisionExecutionAgentRunProfileId"
						:options="[{ value: null, label: 'Use execution profile' }, ...activeAgentRunProfileOptions]"
						:invalid="!!projectCreationForm.errors.revisionExecutionAgentRunProfileId" />
				</UiFormGroup>
				<div class="grid gap-3 md:grid-cols-2">
					<UiFormGroup
						label="Max processable Slice slots"
						for-id="project-slots"
						:error="projectCreationForm.errors.maxProcessableSliceSlots">
						<UiInput id="project-slots" v-model.number="projectCreationForm.maxProcessableSliceSlots" type="number" min="1" />
					</UiFormGroup>
					<UiFormGroup
						label="Max correction retries"
						for-id="project-retries"
						:error="projectCreationForm.errors.maxCorrectionRetriesPerFailure">
						<UiInput
							id="project-retries"
							v-model.number="projectCreationForm.maxCorrectionRetriesPerFailure"
							type="number"
							min="0" />
					</UiFormGroup>
				</div>
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
import UiSelect from '../../components/ui/UiSelect.vue'
import UiText from '../../components/ui/UiText.vue'
import { useSelectedPortfolio } from '../../composables/auth/session'
import { useAgentRunProfilesList } from '../../composables/portfolio/agent-run-profiles'
import { useProjectsCreate } from '../../composables/portfolio/projects'

definePageMeta({ middleware: ['has-selection'] })

const { portfolio } = useSelectedPortfolio()
const { activeAgentRunProfileOptions } = useAgentRunProfilesList()
const { projectCreationForm, isCreatingProject, createProjectError, createProject } = useProjectsCreate({
	onSuccess: async (project) => {
		await navigateTo(`/projects/${project.id}`)
	},
})
</script>
