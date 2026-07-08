<template>
	<NuxtLayout name="project" :project-id="projectId">
		<section>
			<div v-if="isLoadingPlan && !hasLoadedPlan" class="border-b border-dimmer px-3 py-4 text-dim">Loading Plan…</div>
			<p v-if="isRefreshingPlan" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">Refreshing Plan…</p>
			<div v-else-if="planError" class="border-b border-dimmer px-3 py-4 text-error">{{ planError }}</div>
			<div v-else-if="plan" class="grid gap-0">
				<AgentRunSurface
					:key="plan.agentRunId"
					:agent-run-id="plan.agentRunId"
					:disabled="isClosingPlan || isPlanningClosed"
					@message-sending-change="setAgentRunMessageSending" />
			</div>
		</section>

		<template v-if="plan" #right>
			<aside>
				<section class="border-b border-dimmer">
					<div class="px-3 py-3">
						<h2 class="m-0 text-sz-subsection font-semibold">Plan details</h2>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">{{ plan.title }}</p>
					</div>
					<div class="text-sz-helper">
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<span class="text-dim">Created</span><span>{{ formatDate(plan.created.at) }}</span>
						</div>
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<span class="text-dim">State</span><span>{{ plan.closed === null ? 'Planning' : 'Closed' }}</span>
						</div>
					</div>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Planning status</h2>
					<strong class="mt-2 block font-semibold">{{ planningRunTitle }}</strong>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						The Planning Agent Run transcript loads automatically through the Agent Run surface. Closing Planning stops further
						Planning input and model turns without deleting this Plan.
					</p>
					<div class="mt-3 grid gap-2">
						<UiButton
							type="button"
							variant="secondary"
							tone="danger"
							:loading="isClosingPlan"
							:disabled="!canClosePlan"
							@click="confirmAndClosePlan()">
							Close Planning
						</UiButton>
						<UiText v-if="closePlanError" class="block" tone="error" size="helper">
							{{ closePlanError }}
						</UiText>
					</div>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import AgentRunSurface from '../../../../components/portfolio/agent-runs/AgentRunSurface.vue'
import UiButton from '../../../../components/ui/UiButton.vue'
import UiText from '../../../../components/ui/UiText.vue'
import { useOverlay } from '../../../../composables/core/overlay'
import { usePlanClose, usePlanDetail } from '../../../../composables/portfolio/project/plans'
import { formatDate } from '../../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const { confirm } = useOverlay()
const projectId = computed(() => route.params.projectId as string)
const planId = computed(() => route.params.planId as string)
const { plan, isLoadingPlan, planError, hasLoadedPlan, isRefreshingPlan } = usePlanDetail(projectId, planId)

const { isClosingPlan, closePlanError, closePlan } = usePlanClose(projectId, planId)
const isSendingAgentRunMessage = ref(false)

const planningRunTitle = computed(() => (plan.value?.closed === null ? 'Planning in progress' : 'Planning closed'))
const isPlanningClosed = computed(() => plan.value !== null && plan.value.closed !== null)
const canClosePlan = computed(
	() => plan.value !== null && !isPlanningClosed.value && !isClosingPlan.value && !isSendingAgentRunMessage.value,
)
async function confirmAndClosePlan(): Promise<void> {
	const confirmed = await confirm({
		title: 'Close planning?',
		body: 'This Plan will stop accepting new planning messages and model turns. Pending proposals can still be reviewed.',
		confirm: { label: 'Close planning', variant: 'primary', tone: 'danger' },
		cancel: { label: 'Keep planning', variant: 'ghost' },
	})
	if (!confirmed) return

	await closePlan()
}

function setAgentRunMessageSending(isSending: boolean): void {
	isSendingAgentRunMessage.value = isSending
}
</script>
