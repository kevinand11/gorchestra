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
							This Plan has a Planning Agent Run record. Raw transcript events can be inspected manually while richer Planning
							UI remains deferred.
						</p>
					</div>
				</section>

				<section class="px-3 py-3">
					<div class="border border-dimmer bg-card p-3">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<strong class="block font-semibold">Planning Agent Run events</strong>
							<UiButton
								type="button"
								variant="secondary"
								:loading="isLoadingAgentRunEvents"
								:disabled="planningAgentRunId === null"
								@click="refreshAgentRunEvents()">
								Refresh events
							</UiButton>
						</div>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Raw transcript events are shown for verification only. The interactive transcript UI comes in a later slice.
						</p>
						<UiText v-if="agentRunEventsError" class="mt-2 block" tone="error" size="helper">{{ agentRunEventsError }}</UiText>
						<p v-else-if="!hasLoadedAgentRunEvents" class="m-0 mt-3 text-sz-helper text-dim">
							Refresh to load raw Agent Run events.
						</p>
						<p v-else-if="agentRunEvents.length === 0" class="m-0 mt-3 text-sz-helper text-dim">
							No Agent Run events returned.
						</p>
						<ol v-else class="mt-3 grid gap-2 p-0 pl-5 text-sz-helper">
							<li v-for="event in agentRunEvents" :key="event.id" class="break-words border-b border-dimmer pb-2">
								<span class="font-mono text-sz-micro text-dim">#{{ event.sequence }} · {{ event.body.type }}</span>
								<pre
									class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap bg-canvas p-2 text-sz-micro text-card-contrast"
									>{{ eventSummary(event) }}</pre
								>
							</li>
						</ol>
					</div>
				</section>
			</div>
		</section>

		<template v-if="plan" #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Planning status</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">{{ planningRunTitle }}</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					Started {{ formatDate(plan.agentRun.started.at) }}. Use manual event refresh to inspect the raw Planning Agent Run
					transcript while the richer Planning UI is deferred.
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

import UiButton from '../../../../components/ui/UiButton.vue'
import UiText from '../../../../components/ui/UiText.vue'
import { usePortfolioAgentRunEventsQuery, usePortfolioPlanQuery } from '../../../../composables/portfolio-resource-queries'
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

const planningAgentRunId = computed(() => plan.value?.agentRun.id ?? null)
const {
	data: agentRunEvents,
	isLoading: isLoadingAgentRunEvents,
	error: agentRunEventsError,
	hasExecuted: hasLoadedAgentRunEvents,
	execute: refreshAgentRunEvents,
} = usePortfolioAgentRunEventsQuery(serverApi, planningAgentRunId, planId)

const planningModelLabel = computed(() => plan.value?.agentRun.agent.modelId ?? 'Unknown')
const planningRunLabel = computed(() => {
	if (plan.value === null) return 'Unknown'
	return plan.value.agentRun.completed === null ? 'In progress' : `Completed ${formatDate(plan.value.agentRun.completed.at)}`
})
const planningRunTitle = computed(() => (plan.value?.agentRun.completed === null ? 'Planning in progress' : 'Planning completed'))

function eventSummary(event: (typeof agentRunEvents.value)[number]): string {
	return JSON.stringify(event.body, null, 2)
}
</script>
