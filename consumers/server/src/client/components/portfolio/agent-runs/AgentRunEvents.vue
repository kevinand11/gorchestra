<template>
	<div class="grid gap-0">
		<section class="border-b border-dimmer">
			<div class="border-b border-dimmer px-3 py-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<strong class="block font-semibold">Agent Run events</strong>
					<UiButton type="button" variant="secondary" :loading="isLoadingAgentRunEvents" @click="refreshAgentRunEvents()">
						Refresh events
					</UiButton>
				</div>
			</div>
			<UiText v-if="agentRunEventsError" class="block border-b border-dimmer px-3 py-3" tone="error" size="helper">
				{{ agentRunEventsError }}
			</UiText>
			<UiText
				v-else-if="isLoadingAgentRunEvents && !hasLoadedAgentRunEvents"
				class="block border-b border-dimmer px-3 py-3"
				tone="muted"
				size="helper">
				Loading Agent Run events…
			</UiText>
			<UiText v-else-if="!hasLoadedAgentRunEvents" class="block border-b border-dimmer px-3 py-3" tone="muted" size="helper">
				Agent Run events have not loaded yet.
			</UiText>
			<UiText v-else-if="agentRunEvents.length === 0" class="block border-b border-dimmer px-3 py-3" tone="muted" size="helper">
				No Agent Run events returned.
			</UiText>
			<ol v-else class="m-0 grid list-none p-0 text-sz-helper">
				<li
					v-for="event in agentRunEvents"
					:key="event.id"
					class="wrap-break-word border-b border-dimmer px-3 py-2 last:border-b-0">
					<span class="font-mono text-sz-micro text-dim">#{{ event.cursor }} · {{ event.body.type }} · {{ event.id }}</span>
					<pre class="m-0 mt-1 max-h-36 overflow-auto whitespace-pre-wrap font-mono text-sz-micro text-card-contrast">{{
						eventSummary(event)
					}}</pre>
				</li>
			</ol>
		</section>

		<UiForm v-if="!isAgentRunClosed" class="border-b border-dimmer px-3 py-3" @submit.prevent="sendAgentRunMessage()">
			<UiFormGroup for-id="agent-run-message" :error="agentRunMessageForm.errors.text">
				<UiTextarea
					id="agent-run-message"
					v-model="agentRunMessageForm.text"
					rows="5"
					placeholder="Send a follow-up instruction…"
					:invalid="!!agentRunMessageForm.errors.text"
					:disabled="isComposerDisabled" />
			</UiFormGroup>
			<div class="flex flex-wrap items-center gap-3">
				<UiButton type="submit" :loading="isSendingAgentRunMessage" :disabled="!canSendAgentRunMessage"> Send Message </UiButton>
			</div>
			<UiText v-if="sendAgentRunMessageError" class="block" tone="error" size="helper">
				{{ sendAgentRunMessageError }}
			</UiText>
		</UiForm>
	</div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import { useAgentRunEvents, useAgentRunMessageSend } from '../../../composables/portfolio/agent-runs'
import UiButton from '../../ui/UiButton.vue'
import UiForm from '../../ui/UiForm.vue'
import UiFormGroup from '../../ui/UiFormGroup.vue'
import UiText from '../../ui/UiText.vue'
import UiTextarea from '../../ui/UiTextarea.vue'

type AgentRunForEvents = {
	id: string
	completed: { at: string } | null
}

const props = withDefaults(
	defineProps<{
		agentRun: AgentRunForEvents
		disabled?: boolean
	}>(),
	{ disabled: false },
)
const emit = defineEmits<{ 'message-sending-change': [isSending: boolean] }>()

const agentRunId = computed<string | null>(() => props.agentRun.id)
const isAgentRunClosed = computed(() => props.agentRun.completed !== null)
const { agentRunEvents, isLoadingAgentRunEvents, agentRunEventsError, hasLoadedAgentRunEvents, refreshAgentRunEvents } = useAgentRunEvents(
	agentRunId,
	{ immediate: true },
)
const { agentRunMessageForm, isSendingAgentRunMessage, sendAgentRunMessageError, sendAgentRunMessage } = useAgentRunMessageSend(
	agentRunId,
	{ agentRunEvents, hasLoadedAgentRunEvents },
)
const isComposerDisabled = computed(() => props.disabled || isSendingAgentRunMessage.value || isAgentRunClosed.value)
const canSendAgentRunMessage = computed(() => agentRunMessageForm.valid && !isComposerDisabled.value)

watch(isSendingAgentRunMessage, (isSending) => emit('message-sending-change', isSending), { immediate: true })

function eventSummary(event: (typeof agentRunEvents.value)[number]): string {
	return JSON.stringify(event.body, null, 2)
}
</script>
