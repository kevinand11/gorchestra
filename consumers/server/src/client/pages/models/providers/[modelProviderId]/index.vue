<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<NuxtLink class="text-sz-helper font-semibold text-primary hover:brightness-110" to="/models/providers">← Models</NuxtLink>
			<h1 class="m-0 mt-2 text-sz-section font-semibold tracking-[-0.01em]">{{ provider?.name ?? 'Loading Model Provider…' }}</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Manage provider metadata, lifecycle, and Models under this provider.</p>
		</header>

		<section>
			<div v-if="isLoadingProvider && !hasLoadedProvider" class="border-b border-dimmer px-3 py-4 text-dim">
				Loading Model Provider…
			</div>
			<p v-if="isRefreshingProvider" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Model Provider…
			</p>
			<div v-else-if="providerError" class="border-b border-dimmer px-3 py-4 text-error">{{ providerError }}</div>
			<div v-else-if="provider" class="grid gap-0">
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Provider metadata</h2>
					<div class="mt-2 grid gap-2 text-sz-helper sm:grid-cols-2">
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Status</span
							><span :class="provider.archived ? 'text-dim' : 'text-success'">{{
								provider.archived ? 'Archived' : 'Active'
							}}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Source</span><span>{{ modelProviderSourceLabel(provider.source) }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Protocol</span><span class="font-mono">{{ provider.protocol }}</span>
						</div>
						<div
							v-if="provider.source.type === 'custom-hosted'"
							class="flex justify-between gap-3 border-b border-dimmer py-2 sm:col-span-2">
							<span class="text-dim">Base URL</span
							><span class="min-w-0 truncate font-mono">{{ provider.source.baseUrl }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Auth Secret</span
							><span>{{ provider.auth === null ? 'None' : provider.auth.value.secretId }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Headers</span><span>{{ provider.headers.length }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Created</span><span>{{ formatDate(provider.created.at) }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Updated</span
							><span>{{ provider.updated === null ? 'Never' : formatDate(provider.updated.at) }}</span>
						</div>
					</div>
				</section>

				<section>
					<div class="flex min-h-11 items-center border-b border-dimmer px-3 py-2">
						<h2 class="m-0 text-sz-subsection font-semibold">Models</h2>
					</div>
					<div v-if="provider.models.length === 0" class="border-b border-dimmer px-3 py-4">
						<h3 class="m-0 text-sz-helper font-semibold">No Models yet.</h3>
						<p class="m-0 mt-1 text-sz-helper text-dim">
							Add a Model from the right rail before selecting this provider in Portfolio Config.
						</p>
					</div>
					<nav v-else aria-label="Models">
						<NuxtLink
							v-for="model in provider.models"
							:key="model.id"
							:to="`/models/providers/${provider.id}/models/${model.id}`"
							class="grid min-h-[54px] grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-dimmer px-3 py-3 text-body hover:bg-card focus-visible:bg-secondary"
							:class="model.archived ? 'opacity-50' : ''">
							<div class="min-w-0">
								<strong class="block truncate font-semibold">{{ model.name }}</strong>
								<span class="mt-1 block truncate text-sz-helper text-dim font-mono">{{ model.providerModelId }}</span>
							</div>
							<span class="self-center text-sz-helper" :class="model.archived ? 'text-dim' : 'text-success'">{{
								model.archived ? 'Archived' : 'Active'
							}}</span>
						</NuxtLink>
					</nav>
				</section>
			</div>
		</section>

		<template v-if="provider" #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<div>
						<h2 class="m-0 text-sz-subsection font-semibold">Provider actions</h2>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Edit metadata, Secret references, and provider options without changing the immutable source.
						</p>
					</div>
					<UiForm class="mt-3 grid gap-3" @submit.prevent="saveProvider()">
						<UiFormGroup label="Provider name" for-id="provider-name" :error="providerForm.errors.name">
							<UiInput id="provider-name" v-model="providerForm.name" :invalid="!!providerForm.errors.name" />
						</UiFormGroup>
						<UiFormGroup label="API key Secret" for-id="provider-auth-secret" :error="providerForm.errors.authSecretId">
							<UiSelect
								id="provider-auth-secret"
								v-model="providerForm.authSecretId"
								:options="authSecretOptions"
								placeholder="No auth Secret" />
						</UiFormGroup>
						<UiFormGroup
							label="Provider options JSON"
							for-id="provider-options"
							:error="providerForm.errors.providerOptionsText">
							<UiTextarea
								id="provider-options"
								v-model="providerForm.providerOptionsText"
								placeholder='{ "serviceTier": "flex" }'
								:invalid="!!providerForm.errors.providerOptionsText" />
						</UiFormGroup>
						<div class="flex flex-wrap items-center gap-2">
							<UiButton
								type="submit"
								variant="secondary"
								:loading="isSavingProvider"
								:disabled="!providerForm.valid || !providerForm.dirty"
								>Save Provider</UiButton
							>
						</div>
						<UiText v-if="saveProviderError" tone="error">{{ saveProviderError }}</UiText>
					</UiForm>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Provider lifecycle</h2>
					<div class="mt-3">
						<UiButton
							v-if="provider.archived"
							type="button"
							variant="secondary"
							:loading="isChangingProviderLifecycle"
							@click="unarchiveProvider()"
							>Unarchive Provider</UiButton
						>
						<UiButton
							v-else
							type="button"
							variant="ghost"
							:loading="isChangingProviderLifecycle"
							@click="requestProviderArchive()"
							>Archive Provider</UiButton
						>
					</div>
					<UiText v-if="providerLifecycleError" tone="error">{{ providerLifecycleError }}</UiText>
				</section>

				<section class="px-3 py-3">
					<div>
						<h2 class="m-0 text-sz-subsection font-semibold">Add Model</h2>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Add Models under this Provider before selecting them in Portfolio Config.
						</p>
					</div>
					<UiForm class="mt-3 grid gap-3" @submit.prevent="createModel()">
						<UiFormGroup label="New Model name" for-id="model-name" :error="modelCreationForm.errors.name">
							<UiInput
								id="model-name"
								v-model="modelCreationForm.name"
								placeholder="GPT 4.1"
								:invalid="!!modelCreationForm.errors.name" />
						</UiFormGroup>
						<UiFormGroup label="Provider model id" for-id="provider-model-id" :error="modelCreationForm.errors.providerModelId">
							<UiInput
								id="provider-model-id"
								v-model="modelCreationForm.providerModelId"
								placeholder="gpt-4.1"
								:invalid="!!modelCreationForm.errors.providerModelId" />
						</UiFormGroup>
						<UiFormGroup
							label="Model provider options JSON"
							for-id="model-provider-options"
							:error="modelCreationForm.errors.providerOptionsText">
							<UiTextarea
								id="model-provider-options"
								v-model="modelCreationForm.providerOptionsText"
								placeholder='{ "reasoningEffort": "high" }'
								:invalid="!!modelCreationForm.errors.providerOptionsText" />
						</UiFormGroup>
						<UiButton
							type="submit"
							variant="secondary"
							:loading="isCreatingModel"
							:disabled="!modelCreationForm.valid || provider.archived"
							>Add Model</UiButton
						>
						<UiText v-if="createModelError" tone="error">{{ createModelError }}</UiText>
					</UiForm>
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
import UiInput from '../../../../components/ui/UiInput.vue'
import UiSelect from '../../../../components/ui/UiSelect.vue'
import UiText from '../../../../components/ui/UiText.vue'
import UiTextarea from '../../../../components/ui/UiTextarea.vue'
import type { ModelProviderSource } from '../../../../composables/core/server-api'
import { useOverlay } from '../../../../composables/core/overlay'
import {
	useModelCreate,
	useModelProviderDetail,
	useModelProviderLifecycle,
	useModelProviderUpdate,
} from '../../../../composables/portfolio/models/providers'
import { useActiveSecretSelectOptions } from '../../../../composables/portfolio/secrets'
import { formatDate } from '../../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const router = useRouter()
const modelProviderId = computed(() => route.params.modelProviderId as string)
const { confirm } = useOverlay()

const { provider, isLoadingProvider, providerError, hasLoadedProvider, isRefreshingProvider } = useModelProviderDetail(modelProviderId)
const { providerForm, isSavingProvider, saveProviderError, saveProvider } = useModelProviderUpdate(modelProviderId, provider)
const { activeSecretOptions: secretOptions } = useActiveSecretSelectOptions()
const { isChangingProviderLifecycle, providerLifecycleError, runProviderLifecycle } = useModelProviderLifecycle(modelProviderId)
const { modelCreationForm, isCreatingModel, createModelError, createModel } = useModelCreate(modelProviderId, {
	onSuccess: async (model) => {
		await router.push(`/models/providers/${modelProviderId.value}/models/${model.id}`)
	},
})

const authSecretOptions = computed(() => [{ value: null, label: 'No auth Secret' }, ...secretOptions.value])

function modelProviderSourceLabel(source: ModelProviderSource): string {
	switch (source.type) {
		case 'openai-responses':
			return 'OpenAI Responses'
		case 'anthropic':
			return 'Anthropic'
		case 'google':
			return 'Google'
		case 'groq':
			return 'Groq'
		case 'custom-hosted':
			return 'Custom hosted'
		default:
			throw new Error(`Unexpected Model Provider Source: ${String(source satisfies never)}`)
	}
}

async function requestProviderArchive(): Promise<void> {
	const confirmed = await confirm({
		title: 'Archive Model Provider?',
		body: 'Archiving can make Portfolio Config references unusable until the config is changed.',
		confirm: { label: 'Archive Provider', tone: 'danger' },
	})
	if (!confirmed) return
	await runProviderLifecycle('archive')
}

function unarchiveProvider(): Promise<unknown> {
	return runProviderLifecycle('unarchive')
}
</script>
