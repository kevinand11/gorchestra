<template>
	<NuxtLayout name="project" :project-id="projectId">
		<header class="border-b border-dimmer px-3 pt-3 pb-4">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">New Plan</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Start a Planning Agent Run with a selected Agent Run Profile.</p>
		</header>

		<section class="px-3 py-3">
			<UiForm @submit.prevent="createPlan()">
				<UiFormGroup label="Plan title" for-id="plan-title" :error="planCreationForm.errors.title">
					<UiInput id="plan-title" v-model="planCreationForm.title" :invalid="!!planCreationForm.errors.title" />
				</UiFormGroup>
				<UiFormGroup label="Initial message" for-id="initial-message" :error="planCreationForm.errors.initialMessage">
					<UiTextarea
						id="initial-message"
						v-model="planCreationForm.initialMessage"
						:invalid="!!planCreationForm.errors.initialMessage" />
				</UiFormGroup>
				<UiFormGroup label="Agent Run Profile" for-id="plan-agent-run-profile" :error="planCreationForm.errors.agentRunProfileId">
					<UiSelect
						id="plan-agent-run-profile"
						v-model="planCreationForm.agentRunProfileId"
						:options="activeAgentRunProfileOptions"
						placeholder="Select Agent Run Profile"
						:invalid="!!planCreationForm.errors.agentRunProfileId" />
				</UiFormGroup>
				<div class="mt-3 flex flex-wrap items-center gap-2">
					<UiButton type="submit" :loading="isCreatingPlan" :disabled="!planCreationForm.valid">Create Plan</UiButton>
					<UiText v-if="createPlanError" tone="error">{{ createPlanError }}</UiText>
				</div>
			</UiForm>
		</section>

		<template #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Planning profile</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						The selected profile is snapshotted onto the Planning Agent Run. Future profile edits do not change existing runs.
					</p>
				</section>
				<section class="px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Setup</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">Create active Agent Run Profiles before starting Plans.</p>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import UiButton from '../../../../components/ui/UiButton.vue'
import UiForm from '../../../../components/ui/UiForm.vue'
import UiFormGroup from '../../../../components/ui/UiFormGroup.vue'
import UiInput from '../../../../components/ui/UiInput.vue'
import UiSelect from '../../../../components/ui/UiSelect.vue'
import UiTextarea from '../../../../components/ui/UiTextarea.vue'
import UiText from '../../../../components/ui/UiText.vue'
import { useAgentRunProfilesList } from '../../../../composables/portfolio/agent-run-profiles'
import { usePlansCreate } from '../../../../composables/portfolio/project/plans'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const projectId = computed(() => String(route.params.projectId ?? ''))
const { activeAgentRunProfileOptions } = useAgentRunProfilesList()
const { planCreationForm, isCreatingPlan, createPlanError, createPlan } = usePlansCreate(projectId, {
	onSuccess: async (plan) => {
		await navigateTo(`/projects/${projectId.value}/plans/${plan.id}`)
	},
})
</script>
