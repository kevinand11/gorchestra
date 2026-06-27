<template>
	<NuxtLayout name="project" :project-id="projectId">
		<section>
			<div v-if="isLoadingPlan && !hasLoadedPlan" class="border-b border-dimmer px-3 py-4 text-dim">Loading Plan…</div>
			<p v-if="isLoadingPlan && hasLoadedPlan" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Plan…
			</p>
			<div v-else-if="planError" class="border-b border-dimmer px-3 py-4 text-error">{{ planError }}</div>
			<div v-else-if="plan" class="grid gap-0">
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">{{ plan.title }}</h2>
					<div class="mt-2 grid gap-2 text-sz-helper sm:grid-cols-2">
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Created</span><span>{{ formatDate(plan.created.at) }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Planning model</span><span>{{ planningModelLabel }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Planning run</span><span>{{ planningRunLabel }}</span>
						</div>
					</div>
				</section>

				<section class="px-3 py-3">
					<div class="border border-dimmer bg-card p-3">
						<strong class="block font-semibold">Planning Agent Run created.</strong>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							This Plan has a Planning Agent Run record. Plan Output generation, review, and acceptance come in a later slice.
						</p>
					</div>
				</section>
			</div>
		</section>

		<template v-if="plan" #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Planning status</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">{{ planningRunTitle }}</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					Started {{ formatDate(plan.agentRun.started.at) }}. Plan Output generation is still deferred.
				</p>
			</div>
			<div class="px-3 py-3">
				<NuxtLink
					class="inline-flex border border-dimmer bg-secondary px-3 py-1.5 text-sz-helper font-semibold text-secondary-contrast hover:bg-card"
					:to="`/projects/${projectId}/deliveries`">
					View Deliveries
				</NuxtLink>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { usePortfolioPlanQuery } from '../../../../composables/portfolio-resource-queries'
import { useServerApi } from '../../../../composables/useServerApi'
import { formatDate } from '../../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const serverApi = useServerApi()
const projectId = computed(() => route.params.projectId as string)
const planId = computed(() => route.params.planId as string)
const {
	data: plan,
	isLoading: isLoadingPlan,
	error: planError,
	hasExecuted: hasLoadedPlan,
} = usePortfolioPlanQuery(serverApi, projectId, planId)

const planningModelLabel = computed(() => plan.value?.agentRun.agent.modelId ?? 'Unknown')
const planningRunLabel = computed(() => {
	if (plan.value === null) return 'Unknown'
	return plan.value.agentRun.completed === null ? 'In progress' : `Completed ${formatDate(plan.value.agentRun.completed.at)}`
})
const planningRunTitle = computed(() => (plan.value?.agentRun.completed === null ? 'Planning in progress' : 'Planning completed'))
</script>
