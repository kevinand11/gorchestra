<template>
	<NuxtLayout name="project" :project-id="projectId">
		<section class="px-3 py-3">
			<UiForm class="max-w-[560px]" @submit.prevent="createPlan()">
				<UiFormGroup label="Plan title" for-id="plan-title" :error="planCreationForm.errors.title">
					<UiInput
						id="plan-title"
						v-model="planCreationForm.title"
						required
						placeholder="Plan Repository onboarding"
						:invalid="!!planCreationForm.errors.title" />
				</UiFormGroup>
				<UiFormGroup label="Initial planning message" for-id="plan-initial-message" :error="planCreationForm.errors.initialMessage">
					<UiTextarea
						id="plan-initial-message"
						v-model="planCreationForm.initialMessage"
						required
						rows="7"
						placeholder="Describe what you want the planning agent to explore."
						:invalid="!!planCreationForm.errors.initialMessage" />
				</UiFormGroup>
				<div class="flex flex-wrap items-center gap-2">
					<UiButton type="submit" :loading="isCreatingPlan" :disabled="!planCreationForm.valid">Create Plan</UiButton>
				</div>
				<UiText v-if="createPlanError" tone="error">{{ createPlanError }}</UiText>
			</UiForm>
		</section>

		<template #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Guidance</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">Capture the planning target</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					Choose a title and first message that describe the problem or discovery track this Plan will hold.
				</p>
			</div>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">What gets created</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">A Plan and Planning Agent Run</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					Creating a Plan starts its Planning Agent Run record and stores your first message in the transcript. Model response
					scheduling comes later.
				</p>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import UiButton from '../../../../components/ui/UiButton.vue'
import UiForm from '../../../../components/ui/UiForm.vue'
import UiFormGroup from '../../../../components/ui/UiFormGroup.vue'
import UiInput from '../../../../components/ui/UiInput.vue'
import UiTextarea from '../../../../components/ui/UiTextarea.vue'
import UiText from '../../../../components/ui/UiText.vue'
import { useApiAction } from '../../../../composables/action-state'
import { useQueryCache } from '../../../../composables/query-cache'
import { useSelectedPortfolio } from '../../../../composables/selected-portfolio'
import { useServerApi } from '../../../../composables/useServerApi'
import { useToasts } from '../../../../composables/toasts'
import { PlanCreationFormDraft } from '../../../../forms/plan'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const projectId = computed(() => route.params.projectId as string)
const { portfolio } = useSelectedPortfolio()
const serverApi = useServerApi()
const toasts = useToasts()
const queryCache = useQueryCache()
const { queryKeys } = queryCache
const planCreationForm = new PlanCreationFormDraft()

const {
	isLoading: isCreatingPlan,
	error: createPlanError,
	execute: createPlan,
} = useApiAction(async () => {
	const plan = await serverApi.createPlan(projectId.value, planCreationForm.toModel())
	queryCache.set(queryKeys.portfolio.plan(portfolio.value.id, projectId.value, plan.id), plan)
	queryCache.invalidate(queryKeys.portfolio.plans(portfolio.value.id, projectId.value), { exact: true })
	toasts.success({ title: 'Plan created.', body: plan.title })
	await navigateTo(`/projects/${projectId.value}/plans/${plan.id}`)
})
</script>
