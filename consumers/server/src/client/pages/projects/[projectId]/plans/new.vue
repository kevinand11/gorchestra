<template>
	<NuxtLayout name="project" :project-id="projectId">
		<section class="px-3 py-3">
			<form class="grid max-w-[560px] gap-3" @submit.prevent="createPlan()">
				<label class="grid gap-1.5 font-semibold" for="plan-title">
					Plan title
					<UiInput
						id="plan-title"
						v-model="planCreationForm.title"
						required
						placeholder="Plan Repository onboarding"
						:invalid="!!planCreationForm.errors.title" />
				</label>
				<UiText v-if="planCreationForm.errors.title" tone="error" size="helper">
					{{ planCreationForm.errors.title }}
				</UiText>
				<div class="flex flex-wrap items-center gap-2">
					<UiButton type="submit" :loading="isCreatingPlan" :disabled="!planCreationForm.valid">Create Plan</UiButton>
				</div>
				<UiText v-if="createPlanError" tone="error">{{ createPlanError }}</UiText>
			</form>
		</section>

		<template #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Guidance</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">Capture the planning target</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					Choose a title that describes the problem or discovery track this Plan will hold.
				</p>
			</div>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">What gets created</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">A Plan and Planning Agent Run</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					Creating a Plan also starts its Planning Agent Run record. Plan Output generation and review come later.
				</p>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import UiButton from '../../../../components/ui/UiButton.vue'
import UiInput from '../../../../components/ui/UiInput.vue'
import UiText from '../../../../components/ui/UiText.vue'
import { useApiAction } from '../../../../composables/action-state'
import { useQueryCache } from '../../../../composables/query-cache'
import { useSelectedPortfolio } from '../../../../composables/selected-portfolio'
import { useServerApi } from '../../../../composables/useServerApi'
import { useToasts } from '../../../../composables/toasts'
import { PlanCreationFormFactory } from '../../../../forms/plan'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const projectId = computed(() => route.params.projectId as string)
const { portfolio } = useSelectedPortfolio()
const serverApi = useServerApi()
const toasts = useToasts()
const queryCache = useQueryCache()
const { queryKeys } = queryCache
const planCreationForm = new PlanCreationFormFactory()

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
