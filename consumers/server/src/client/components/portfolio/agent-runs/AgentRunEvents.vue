<template>
	<div class="grid gap-0">
		<section class="border-b border-dimmer">
			<div class="border-b border-dimmer px-3 py-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<strong class="block font-semibold">Agent Run events</strong>
					<UiButton
						type="button"
						variant="secondary"
						:loading="isLoadingAgentRunEvents"
						:disabled="!hasNextAgentRunEvents"
						@click="fetchNextAgentRunEvents()">
						Load older events
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
					<span class="font-mono text-sz-micro text-dim">#{{ event.id }} · {{ eventTitle(event) }} · {{ event.id }}</span>
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
const {
	agentRunEvents,
	isLoadingAgentRunEvents,
	agentRunEventsError,
	hasLoadedAgentRunEvents,
	fetchNextAgentRunEvents,
	hasNextAgentRunEvents,
} = useAgentRunEvents(agentRunId)
const { agentRunMessageForm, isSendingAgentRunMessage, sendAgentRunMessageError, sendAgentRunMessage } = useAgentRunMessageSend(agentRunId)
const isComposerDisabled = computed(() => props.disabled || isSendingAgentRunMessage.value || isAgentRunClosed.value)
const canSendAgentRunMessage = computed(() => agentRunMessageForm.valid && !isComposerDisabled.value)

watch(isSendingAgentRunMessage, (isSending) => emit('message-sending-change', isSending), { immediate: true })

type AgentRunEvent = (typeof agentRunEvents.value)[number]
type AgentRunEventBody<TType extends AgentRunEvent['body']['type']> = Extract<AgentRunEvent['body'], { type: TType }>
type TextTranscriptPart = { text: string }

function eventTitle(event: AgentRunEvent): string {
	switch (event.body.type) {
		case 'agent-run-model-use-override-changed':
			return 'Model use override changed'
		case 'agent-run-runtime-requirement-override-added':
			return 'Runtime requirement override added'
		case 'agent-run-sandbox-created':
			return 'Sandbox created'
		case 'agent-run-preparation-started':
			return 'Agent Run preparation started'
		case 'agent-run-preparation-completed':
			return 'Agent Run preparation completed'
		case 'agent-run-preparation-failed':
			return 'Agent Run preparation failed'
		case 'agent-run-sandbox-release-completed':
			return 'Sandbox release completed'
		case 'agent-run-sandbox-release-failed':
			return 'Sandbox release failed'
		case 'instruction-snapshot':
			return 'Instruction snapshot'
		case 'input-message':
			return 'Input message'
		case 'turn-started':
			return 'Turn started'
		case 'turn-ended':
			return 'Turn ended'
		case 'assistant-message':
			return 'Assistant message'
		case 'tool-message':
			return 'Tool message'
		case 'interrupt-requested':
			return 'Interrupt requested'
		case 'proposed-plan-output':
			return 'Plan output proposed'
		case 'proposed-revision-output':
			return 'Revision output proposed'
		case 'proposal-accepted':
			return 'Proposal accepted'
		case 'proposal-rejected':
			return 'Proposal rejected'
		case 'context-compacted':
			return 'Context compacted'
		default:
			return unexpectedEventBody(event.body)
	}
}

function eventSummary(event: AgentRunEvent): string {
	switch (event.body.type) {
		case 'instruction-snapshot':
			return textPartsSummary(event.body.parts)
		case 'input-message':
			return textPartsSummary(event.body.parts)
		case 'assistant-message':
			return assistantMessageSummary(event.body)
		case 'tool-message':
			return toolMessageSummary(event.body)
		case 'turn-started':
			return `Context through ${event.body.contextThroughEventId}\nReason: ${event.body.reason.type}\nInput events: ${event.body.reason.inputEventIds.join(', ')}`
		case 'turn-ended':
			return event.body.outcome.type === 'completed' ? 'Completed' : `Error: ${event.body.outcome.reason.type}`
		case 'proposal-accepted':
			return `Proposal ${event.body.proposalEventId} accepted.\n${textPartsSummary(event.body.projectedParts)}`
		case 'proposal-rejected':
			return `Proposal ${event.body.proposalEventId} rejected.${event.body.reason === null ? '' : ` ${event.body.reason}`}\n${textPartsSummary(event.body.projectedParts)}`
		case 'context-compacted':
			return `Compacted through ${event.body.compactedThroughEventId}\n${textPartsSummary(event.body.replacementParts)}`
		case 'agent-run-model-use-override-changed':
		case 'agent-run-runtime-requirement-override-added':
		case 'agent-run-sandbox-created':
		case 'agent-run-preparation-started':
		case 'agent-run-preparation-completed':
		case 'agent-run-preparation-failed':
		case 'agent-run-sandbox-release-completed':
		case 'agent-run-sandbox-release-failed':
		case 'interrupt-requested':
		case 'proposed-plan-output':
		case 'proposed-revision-output':
			return JSON.stringify(event.body, null, 2)
		default:
			return unexpectedEventBody(event.body)
	}
}

function assistantMessageSummary(body: AgentRunEventBody<'assistant-message'>): string {
	const parts = body.parts.map(assistantPartSummary)
	return [`Finish: ${body.finishReason}`, `Model: ${body.model.providerModelId}`, ...parts].join('\n')
}

function assistantPartSummary(part: AgentRunEventBody<'assistant-message'>['parts'][number]): string {
	switch (part.type) {
		case 'text':
			return part.text
		case 'reasoning':
			return `[reasoning: ${part.text.length} chars]`
		case 'reasoning-file':
			return `[reasoning file: ${part.mediaType}]`
		case 'source':
			return `[source: ${part.title ?? part.url ?? part.id}]`
		case 'file':
			return `[file: ${part.filename ?? part.mediaType}]`
		case 'custom':
			return `[custom: ${part.kind}]`
		case 'tool-call':
			return `[tool call: ${part.toolName} (${part.toolCallId})] ${formatUnknown(part.input)}`
		case 'tool-result':
			return `[provider tool result: ${part.toolName} (${part.toolCallId})] ${toolOutputSummary(part.output)}`
		case 'tool-error':
			return `[provider tool error: ${part.toolName} (${part.toolCallId})] ${formatUnknown(part.error)}`
		case 'tool-approval-request':
			return `[tool approval request: ${part.toolName} (${part.toolCallId})] ${part.approvalId}`
		default:
			return unexpectedPart(part)
	}
}

function toolMessageSummary(body: AgentRunEventBody<'tool-message'>): string {
	return body.parts.map(toolPartSummary).join('\n')
}

function toolPartSummary(part: AgentRunEventBody<'tool-message'>['parts'][number]): string {
	switch (part.type) {
		case 'tool-result':
			return `[tool result: ${part.toolName} (${part.toolCallId})] ${toolOutputSummary(part.output)}`
		case 'tool-error':
			return `[tool error: ${part.toolName} (${part.toolCallId}); ${part.reason.type}] ${toolOutputSummary(part.error)}`
		case 'tool-approval-response':
			return `[tool approval response: ${part.approvalId}] ${part.approved ? 'approved' : 'rejected'}${part.reason === null ? '' : `: ${part.reason}`}`
		default:
			return unexpectedPart(part)
	}
}

function toolOutputSummary(
	output: AgentRunEventBody<'tool-message'>['parts'][number] extends infer TPart
		? TPart extends { output: infer TOutput }
			? TOutput
			: TPart extends { error: infer TError }
				? TError
				: never
		: never,
): string {
	switch (output.type) {
		case 'text':
		case 'error-text':
			return output.value
		case 'json':
			return formatUnknown(output.value)
		case 'execution-denied':
			return output.reason === null ? 'execution denied' : `execution denied: ${output.reason}`
		default:
			return unexpectedPart(output)
	}
}

function textPartsSummary(parts: readonly TextTranscriptPart[]): string {
	return parts.map((part) => part.text).join('\n')
}

function formatUnknown(value: unknown): string {
	if (typeof value === 'string') return value
	try {
		return JSON.stringify(value, null, 2) ?? String(value)
	} catch {
		return String(value)
	}
}

function unexpectedEventBody(body: never): never {
	throw new Error(`Unexpected Agent Run event body: ${String(body)}`)
}

function unexpectedPart(part: never): never {
	throw new Error(`Unexpected Agent Run transcript part: ${String(part)}`)
}
</script>
