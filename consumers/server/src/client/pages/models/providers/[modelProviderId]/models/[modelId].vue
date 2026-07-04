<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<NuxtLink class="text-sz-helper font-semibold text-primary hover:brightness-110" :to="`/models/providers/${modelProviderId}`">
				← Model Provider
			</NuxtLink>
			<h1 class="m-0 mt-2 text-sz-section font-semibold tracking-[-0.01em]">{{ model?.name ?? 'Loading Model…' }}</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Manage Model metadata, capabilities, preflight, lifecycle, and references.</p>
		</header>

		<section>
			<div v-if="isLoadingModel && !hasLoadedModel" class="border-b border-dimmer px-3 py-4 text-dim">Loading Model…</div>
			<p v-if="isRefreshingModel" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">Refreshing Model…</p>
			<div v-else-if="modelError" class="border-b border-dimmer px-3 py-4 text-error">{{ modelError }}</div>
			<div v-else-if="model" class="grid gap-0">
				<UiForm class="border-b border-dimmer" @submit.prevent="saveModel()">
					<section class="border-b border-dimmer px-3 py-3">
						<h2 class="m-0 text-sz-subsection font-semibold">Editable metadata</h2>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Update the user-facing Model name and capability metadata stored in Core.
						</p>
						<div class="mt-3 grid gap-3 md:grid-cols-2">
							<UiFormGroup label="Model name" for-id="model-name" :error="modelUpdateForm.errors.name">
								<UiInput id="model-name" v-model="modelUpdateForm.name" :invalid="!!modelUpdateForm.errors.name" />
							</UiFormGroup>
							<UiFormGroup label="Provider model id" for-id="provider-model-id">
								<UiInput id="provider-model-id" :model-value="model.providerModelId" disabled />
							</UiFormGroup>
						</div>
					</section>

					<section class="border-b border-dimmer px-3 py-3">
						<h2 class="m-0 text-sz-subsection font-semibold">Provider options</h2>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Optional model-local AI SDK provider options override provider-level options for this Model.
						</p>
						<UiFormGroup
							class="mt-3"
							label="Provider options JSON"
							for-id="model-provider-options"
							:error="modelUpdateForm.errors.providerOptionsText">
							<UiTextarea
								id="model-provider-options"
								v-model="modelUpdateForm.providerOptionsText"
								placeholder='{ "reasoningEffort": "high" }'
								:invalid="!!modelUpdateForm.errors.providerOptionsText" />
						</UiFormGroup>
					</section>

					<section class="border-b border-dimmer px-3 py-3">
						<h2 class="m-0 text-sz-subsection font-semibold">Capability limits</h2>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Context window is setup metadata until token counting lands. Max output tokens are passed to provider calls as
							the output cap.
						</p>
						<div class="mt-3 grid gap-3 md:grid-cols-2">
							<UiFormGroup label="Supported inputs" for-id="model-inputs">
								<UiInput id="model-inputs" :model-value="modelUpdateForm.capabilities.inputs.join(', ')" disabled />
							</UiFormGroup>
							<UiFormGroup label="Context window tokens" for-id="context-window-tokens">
								<UiInput
									id="context-window-tokens"
									v-model="modelUpdateForm.capabilities.contextWindowTokens"
									type="number"
									:min="1" />
							</UiFormGroup>
							<UiFormGroup label="Max output tokens" for-id="max-output-tokens">
								<UiInput
									id="max-output-tokens"
									v-model="modelUpdateForm.capabilities.maxOutputTokens"
									type="number"
									:min="1" />
							</UiFormGroup>
						</div>
					</section>

					<section class="border-b border-dimmer px-3 py-3">
						<h2 class="m-0 text-sz-subsection font-semibold">Thinking</h2>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Enabled levels become selectable Model Thinking Levels for this Model. None is always available and requests
							provider reasoning be disabled when possible.
						</p>
						<div class="mt-3 border-y border-dimmer">
							<div
								v-for="level in configurableThinkingLevels"
								:key="level"
								class="border-b border-dimmer py-2 last:border-b-0">
								<UiCheckbox v-model="modelUpdateForm.capabilities.thinking[level]" class="font-semibold">
									{{ thinkingLevelLabel(level) }}
								</UiCheckbox>
							</div>
						</div>
					</section>

					<section class="border-b border-dimmer px-3 py-3">
						<div class="flex items-start justify-between gap-3">
							<div>
								<h2 class="m-0 text-sz-subsection font-semibold">Pricing</h2>
								<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
									Pricing is stored as micro-USD per million tokens and displayed here as dollars per million tokens.
								</p>
							</div>
							<UiButton type="button" variant="ghost" @click="togglePricing()">{{
								modelUpdateForm.pricing.enabled ? 'Clear' : 'Configure'
							}}</UiButton>
						</div>
						<div v-if="modelUpdateForm.pricing.enabled" class="mt-3 grid gap-3 md:grid-cols-2">
							<UiFormGroup label="Input $ per 1M tokens" for-id="pricing-input">
								<UiInput
									id="pricing-input"
									v-model="modelUpdateForm.pricing.inputUsdPerMillion"
									type="number"
									:min="0"
									step="0.000001" />
							</UiFormGroup>
							<UiFormGroup label="Output $ per 1M tokens" for-id="pricing-output">
								<UiInput
									id="pricing-output"
									v-model="modelUpdateForm.pricing.outputUsdPerMillion"
									type="number"
									:min="0"
									step="0.000001" />
							</UiFormGroup>
							<UiFormGroup label="Cache read $ per 1M tokens" for-id="pricing-cache-read">
								<UiInput
									id="pricing-cache-read"
									v-model="modelUpdateForm.pricing.cacheReadUsdPerMillion"
									type="number"
									:min="0"
									step="0.000001" />
							</UiFormGroup>
							<UiFormGroup label="Cache write $ per 1M tokens" for-id="pricing-cache-write">
								<UiInput
									id="pricing-cache-write"
									v-model="modelUpdateForm.pricing.cacheWriteUsdPerMillion"
									type="number"
									:min="0"
									step="0.000001" />
							</UiFormGroup>
						</div>
					</section>

					<section class="px-3 py-3">
						<UiButton
							type="submit"
							variant="secondary"
							:loading="isSavingModel"
							:disabled="!modelUpdateForm.valid || !modelUpdateForm.dirty">
							Save Model
						</UiButton>
						<UiText v-if="saveModelError" class="mt-2" tone="error">{{ saveModelError }}</UiText>
					</section>
				</UiForm>
			</div>
		</section>

		<template v-if="model" #right>
			<aside>
				<section class="border-b border-dimmer">
					<div class="px-3 py-3">
						<h2 class="m-0 text-sz-subsection font-semibold">Identity</h2>
					</div>
					<div class="text-sz-helper">
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<span class="text-dim">Status</span
							><span :class="model.archived ? 'text-dim' : 'text-success'">{{ model.archived ? 'Archived' : 'Active' }}</span>
						</div>
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<span class="text-dim">Provider</span><span class="min-w-0 truncate">{{ model.provider.name }}</span>
						</div>
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<span class="text-dim">Protocol</span><span class="font-mono">{{ model.provider.protocol }}</span>
						</div>
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<span class="text-dim">Provider status</span
							><span :class="model.provider.archived ? 'text-dim' : 'text-success'">{{
								model.provider.archived ? 'Archived' : 'Active'
							}}</span>
						</div>
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<span class="text-dim">Created</span><span>{{ formatDate(model.created.at) }}</span>
						</div>
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<span class="text-dim">Updated</span
							><span>{{ model.updated === null ? 'Never' : formatDate(model.updated.at) }}</span>
						</div>
					</div>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Model Preflight</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Check current provider access and model reachability without storing readiness history.
					</p>
					<div class="mt-3 grid gap-2">
						<UiButton
							type="button"
							variant="secondary"
							:loading="isPreflightingModel"
							:disabled="model.archived || model.provider.archived"
							@click="preflightModel()">
							Preflight Model
						</UiButton>
						<UiCallout v-if="preflightEvidence" :tone="preflightEvidence.passed ? 'success' : 'error'">
							{{ preflightEvidence.summary }}
						</UiCallout>
						<UiText v-if="preflightModelError" tone="error">{{ preflightModelError }}</UiText>
					</div>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Model lifecycle</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Archiving prevents new work from selecting this Model while preserving existing references.
					</p>
					<div class="mt-3">
						<UiButton
							v-if="model.archived"
							type="button"
							variant="secondary"
							:loading="isChangingModelLifecycle"
							@click="unarchiveModel()">
							Unarchive Model
						</UiButton>
						<UiButton v-else type="button" variant="ghost" :loading="isChangingModelLifecycle" @click="requestModelArchive()">
							Archive Model
						</UiButton>
					</div>
					<UiText v-if="modelLifecycleError" tone="error">{{ modelLifecycleError }}</UiText>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">References</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Direct config references that can use this Model for future work. Inherited defaults and Agent Run transcript
						history are not included.
					</p>
				</section>
				<section>
					<div
						v-if="isLoadingReferences && !hasLoadedReferences"
						class="border-b border-dimmer px-3 py-3 text-sz-helper text-dim">
						Loading references…
					</div>
					<div v-else-if="referencesError" class="border-b border-dimmer px-3 py-3 text-sz-helper text-error">
						{{ referencesError }}
					</div>
					<div v-else-if="references.length === 0" class="border-b border-dimmer px-3 py-3 text-sz-helper text-dim">
						No direct config references for this Model.
					</div>
					<div v-else>
						<NuxtLink
							v-for="reference in references"
							:key="modelReferenceKey(reference)"
							:to="modelReferenceLocation(reference)"
							class="block border-b border-dimmer px-3 py-2 text-body hover:bg-card focus-visible:bg-secondary"
							:class="reference.active ? '' : 'opacity-50'">
							<strong class="block truncate text-sz-helper font-semibold">{{ modelReferenceTitle(reference) }}</strong>
							<span class="mt-1 block truncate text-sz-micro text-dim">{{ modelReferenceSubtitle(reference) }}</span>
						</NuxtLink>
					</div>
					<p v-if="isRefreshingReferences" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
						Refreshing references…
					</p>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import UiButton from '../../../../../components/ui/UiButton.vue'
import UiCallout from '../../../../../components/ui/UiCallout.vue'
import UiCheckbox from '../../../../../components/ui/UiCheckbox.vue'
import UiForm from '../../../../../components/ui/UiForm.vue'
import UiFormGroup from '../../../../../components/ui/UiFormGroup.vue'
import UiInput from '../../../../../components/ui/UiInput.vue'
import UiText from '../../../../../components/ui/UiText.vue'
import UiTextarea from '../../../../../components/ui/UiTextarea.vue'
import { useOverlay } from '../../../../../composables/core/overlay'
import type { PositiveModelThinkingLevel, ServerApi } from '../../../../../composables/core/server-api'
import { thinkingLevelLabel } from '../../../../../utils/model-provider-options'
import {
	useModelDetail,
	useModelLifecycle,
	useModelPreflight,
	useModelReferences,
	useModelUpdate,
} from '../../../../../composables/portfolio/models/providers'
import { formatDate } from '../../../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type ModelReference = Awaited<ReturnType<ServerApi['listModelReferences']>>[number]

const route = useRoute()
const modelProviderId = computed(() => route.params.modelProviderId as string)
const modelId = computed(() => route.params.modelId as string)
const { confirm } = useOverlay()
const { model, isLoadingModel, modelError, hasLoadedModel, isRefreshingModel } = useModelDetail(modelProviderId, modelId)
const configurableThinkingLevels = computed<PositiveModelThinkingLevel[]>(() => model.value?.provider.configurableThinkingLevels ?? [])
const { references, isLoadingReferences, referencesError, hasLoadedReferences, isRefreshingReferences } = useModelReferences(
	modelProviderId,
	modelId,
)
const { modelUpdateForm, isSavingModel, saveModelError, saveModel } = useModelUpdate(modelProviderId, modelId, model)
const { preflightEvidence, isPreflightingModel, preflightModelError, preflightModel } = useModelPreflight(modelProviderId, modelId, model)
const { isChangingModelLifecycle, modelLifecycleError, runModelLifecycle } = useModelLifecycle(modelProviderId, modelId)

function togglePricing(): void {
	if (modelUpdateForm.pricing.enabled) modelUpdateForm.pricing.clear()
	else modelUpdateForm.pricing.enabled = true
}

async function requestModelArchive(): Promise<void> {
	const confirmed = await confirm({
		title: 'Archive Model?',
		body: 'Archiving can make direct config references unusable until those configs change.',
		confirm: { label: 'Archive Model', tone: 'danger' },
	})
	if (!confirmed) return
	await runModelLifecycle('archive')
}

function unarchiveModel(): Promise<unknown> {
	return runModelLifecycle('unarchive')
}

function modelReferenceTitle(reference: ModelReference): string {
	switch (reference.type) {
		case 'agent-run-profile':
			return 'Agent Run Profile'
		default:
			throw new Error(`Unexpected Model Reference type: ${String(reference.type satisfies never)}`)
	}
}

function modelReferenceSubtitle(reference: ModelReference): string {
	switch (reference.type) {
		case 'agent-run-profile':
			return reference.agentRunProfileName
		default:
			throw new Error(`Unexpected Model Reference type: ${String(reference.type satisfies never)}`)
	}
}

function modelReferenceLocation(reference: ModelReference): string {
	switch (reference.type) {
		case 'agent-run-profile':
			return `/agent-run-profiles/${reference.agentRunProfileId}`
		default:
			throw new Error(`Unexpected Model Reference type: ${String(reference.type satisfies never)}`)
	}
}

function modelReferenceKey(reference: ModelReference): string {
	switch (reference.type) {
		case 'agent-run-profile':
			return `${reference.type}:${reference.agentRunProfileId}`
		default:
			throw new Error(`Unexpected Model Reference type: ${String(reference.type satisfies never)}`)
	}
}
</script>
