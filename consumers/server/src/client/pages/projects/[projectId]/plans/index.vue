<template>
	<NuxtLayout name="project" :project-id="projectId">
		<section>
			<div class="flex min-h-11 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
				<span class="text-sz-helper text-dim">{{ plans.length }} {{ plans.length === 1 ? 'Plan' : 'Plans' }}</span>
				<NuxtLink
					class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast hover:brightness-110"
					:to="`/projects/${projectId}/plans/new`">
					New Plan
				</NuxtLink>
			</div>

			<div v-if="isLoadingPlans && !hasLoadedPlans" class="border-b border-dimmer px-3 py-4 text-dim">Loading Plans…</div>
			<div v-else-if="plansError" class="border-b border-dimmer px-3 py-4 text-error">{{ plansError }}</div>
			<div v-else-if="plans.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Plans yet.</h2>
				<p class="m-0 mt-1 max-w-[680px] text-sz-helper leading-5 text-dim">
					Plans start Planning Agent Runs for this Project. Plan Output generation is not available in this slice.
				</p>
				<NuxtLink
					class="mt-4 inline-flex border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast"
					:to="`/projects/${projectId}/plans/new`">
					Create your first Plan
				</NuxtLink>
			</div>
			<div v-else>
				<NuxtLink
					v-for="plan in plans"
					:key="plan.id"
					:to="`/projects/${projectId}/plans/${plan.id}`"
					class="grid min-h-[58px] grid-cols-[24px_minmax(0,1fr)_120px] items-center gap-2 border-b border-dimmer px-3 py-2 text-body hover:bg-card focus-visible:bg-secondary">
					<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">P</span>
					<span class="min-w-0">
						<strong class="block truncate font-semibold">{{ plan.title }}</strong>
						<span class="text-sz-helper text-dim">Created {{ formatDate(plan.created.at) }}</span>
					</span>
					<span class="justify-self-start border border-dimmer bg-secondary px-2 py-0.5 text-sz-micro font-semibold text-dim">
						{{ plan.agentRun.completed === null ? 'Planning' : 'Completed' }}
					</span>
				</NuxtLink>
			</div>
			<p v-if="isRefreshingPlans" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">Refreshing Plans…</p>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { usePlansList } from '../../../../composables/portfolio/project/plans'
import { formatDate } from '../../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const projectId = computed(() => route.params.projectId as string)
const { plans, isLoadingPlans, plansError, hasLoadedPlans, isRefreshingPlans } = usePlansList(projectId)
</script>
