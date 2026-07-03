<template>
	<NuxtLayout name="project" :project-id="projectId">
		<section>
			<div v-if="isLoadingPlan && !hasLoadedPlan" class="border-b border-dimmer px-3 py-4 text-dim">Loading Plan…</div>
			<p v-if="isRefreshingPlan" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">Refreshing Plan…</p>
			<div v-else-if="planError" class="border-b border-dimmer px-3 py-4 text-error">{{ planError }}</div>
			<div v-else-if="plan" class="grid gap-0">
				<section class="border-b border-dimmer">
					<div class="border-b border-dimmer px-3 py-3">
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
					</div>
					<UiText v-if="agentRunEventsError" class="block border-b border-dimmer px-3 py-3" tone="error" size="helper">
						{{ agentRunEventsError }}
					</UiText>
					<UiText v-else-if="!hasLoadedAgentRunEvents" class="block border-b border-dimmer px-3 py-3" tone="muted" size="helper">
						Refresh to load raw Agent Run events.
					</UiText>
					<UiText
						v-else-if="agentRunEvents.length === 0"
						class="block border-b border-dimmer px-3 py-3"
						tone="muted"
						size="helper">
						No Agent Run events returned.
					</UiText>
					<ol v-else class="m-0 grid list-none p-0 text-sz-helper">
						<li
							v-for="event in agentRunEvents"
							:key="event.id"
							class="wrap-break-word border-b border-dimmer px-3 py-2 last:border-b-0">
							<span class="font-mono text-sz-micro text-dim"
								>{{ event.cursor }} · {{ event.body.type }} · {{ event.id }}</span
							>
							<pre class="m-0 mt-1 max-h-36 overflow-auto whitespace-pre-wrap font-mono text-sz-micro text-card-contrast">{{
								eventSummary(event)
							}}</pre>
						</li>
					</ol>
				</section>

				<UiForm v-if="!isPlanningRunClosed" class="border-b border-dimmer px-3 py-3" @submit.prevent="sendAgentRunMessage()">
					<UiFormGroup for-id="agent-run-message" :error="agentRunMessageForm.errors.text">
						<UiTextarea
							id="agent-run-message"
							v-model="agentRunMessageForm.text"
							rows="5"
							placeholder="Send a follow-up planning instruction…"
							:invalid="!!agentRunMessageForm.errors.text"
							:disabled="isSendingAgentRunMessage || isClosingPlan" />
					</UiFormGroup>
					<div class="flex flex-wrap items-center gap-3">
						<UiButton type="submit" :loading="isSendingAgentRunMessage" :disabled="!canSendAgentRunMessage">
							Send Message
						</UiButton>
					</div>
					<UiText v-if="sendAgentRunMessageError" class="block" tone="error" size="helper">
						{{ sendAgentRunMessageError }}
					</UiText>
				</UiForm>
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
							<span class="text-dim">Planning run</span><span>{{ planningRunLabel }}</span>
						</div>
					</div>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Planning status</h2>
					<strong class="mt-2 block font-semibold">{{ planningRunTitle }}</strong>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Started {{ formatDate(plan.agentRun.started.at) }}. Use manual event refresh to inspect the raw Planning Agent Run
						transcript while the richer Planning UI is deferred.
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
import { computed } from 'vue'

import UiButton from '../../../../components/ui/UiButton.vue'
import UiForm from '../../../../components/ui/UiForm.vue'
import UiFormGroup from '../../../../components/ui/UiFormGroup.vue'
import UiText from '../../../../components/ui/UiText.vue'
import UiTextarea from '../../../../components/ui/UiTextarea.vue'
import { useOverlay } from '../../../../composables/core/overlay'
import { useAgentRunEvents, useAgentRunMessageSend } from '../../../../composables/portfolio/agent-runs'
import { usePlanClose, usePlanDetail } from '../../../../composables/portfolio/project/plans'
import { formatDate } from '../../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const { confirm } = useOverlay()
const projectId = computed(() => route.params.projectId as string)
const planId = computed(() => route.params.planId as string)
const { plan, isLoadingPlan, planError, hasLoadedPlan, isRefreshingPlan } = usePlanDetail(projectId, planId)

const planningAgentRunId = computed(() => plan.value?.agentRun.id ?? null)
const { agentRunEvents, isLoadingAgentRunEvents, agentRunEventsError, hasLoadedAgentRunEvents, refreshAgentRunEvents } =
	useAgentRunEvents(planningAgentRunId)
const { isClosingPlan, closePlanError, closePlan } = usePlanClose(projectId, planId)
const { agentRunMessageForm, isSendingAgentRunMessage, sendAgentRunMessageError, sendAgentRunMessage } = useAgentRunMessageSend(
	planningAgentRunId,
	{ agentRunEvents, hasLoadedAgentRunEvents },
)

const planningRunLabel = computed(() => {
	if (plan.value === null) return 'Unknown'
	return plan.value.agentRun.completed === null ? 'In progress' : `Completed ${formatDate(plan.value.agentRun.completed.at)}`
})
const planningRunTitle = computed(() => (plan.value?.closed === null ? 'Planning in progress' : 'Planning closed'))
const isPlanningClosed = computed(() => plan.value !== null && plan.value.closed !== null)
const isPlanningRunClosed = computed(() => plan.value !== null && plan.value.agentRun.completed !== null)
const canSendAgentRunMessage = computed(() =>
	[
		agentRunMessageForm.valid,
		!isSendingAgentRunMessage.value,
		!isClosingPlan.value,
		!isPlanningClosed.value,
		!isPlanningRunClosed.value,
		planningAgentRunId.value !== null,
	].every(Boolean),
)
const canClosePlan = computed(
	() => planningAgentRunId.value !== null && !isPlanningClosed.value && !isClosingPlan.value && !isSendingAgentRunMessage.value,
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

function eventSummary(event: (typeof agentRunEvents.value)[number]): string {
	return JSON.stringify(event.body, null, 2)
}
</script>
