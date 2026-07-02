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
			<p v-if="isLoadingProvider && hasLoadedProvider" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
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
							<span class="text-dim">Protocol</span><span class="font-mono">{{ provider.protocol.type }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2 sm:col-span-2">
							<span class="text-dim">Base URL</span><span class="min-w-0 truncate font-mono">{{ provider.baseUrl }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Auth Secret</span
							><span>{{ provider.auth === null ? 'None' : provider.auth.secretId }}</span>
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
							Edit metadata and Secret references without changing the protocol.
						</p>
					</div>
					<UiForm class="mt-3 grid gap-3" @submit.prevent="saveProvider()">
						<UiFormGroup label="Provider name" for-id="provider-name" :error="providerForm.errors.name">
							<UiInput id="provider-name" v-model="providerForm.name" :invalid="!!providerForm.errors.name" />
						</UiFormGroup>
						<UiFormGroup label="Base URL" for-id="provider-base-url" :error="providerForm.errors.baseUrl">
							<UiInput id="provider-base-url" v-model="providerForm.baseUrl" :invalid="!!providerForm.errors.baseUrl" />
						</UiFormGroup>
						<UiFormGroup label="API key Secret" for-id="provider-auth-secret" :error="providerForm.errors.authSecretId">
							<UiSelect
								id="provider-auth-secret"
								v-model="providerForm.authSecretId"
								:options="authSecretOptions"
								placeholder="No auth Secret" />
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
					<UiCallout v-if="isProviderArchiveConfirmationVisible" class="mt-3" tone="notice">
						Archiving can make Portfolio Config references unusable until the config is changed.
						<span class="mt-2 flex gap-2">
							<UiButton type="button" variant="secondary" @click="archiveProvider()">Confirm archive</UiButton>
							<UiButton type="button" variant="ghost" @click="isProviderArchiveConfirmationVisible = false">Cancel</UiButton>
						</span>
					</UiCallout>
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
import { computed, ref, watch } from 'vue'

import UiButton from '../../../components/ui/UiButton.vue'
import UiCallout from '../../../components/ui/UiCallout.vue'
import UiForm from '../../../components/ui/UiForm.vue'
import UiFormGroup from '../../../components/ui/UiFormGroup.vue'
import UiInput from '../../../components/ui/UiInput.vue'
import UiSelect from '../../../components/ui/UiSelect.vue'
import UiText from '../../../components/ui/UiText.vue'
import { useApiAction } from '../../../composables/action-state'
import { usePortfolioModelProviderQuery, usePortfolioSecretsQuery } from '../../../composables/portfolio-resource-queries'
import { useQueryCache } from '../../../composables/query-cache'
import { useSelectedPortfolio } from '../../../composables/selected-portfolio'
import { useServerApi } from '../../../composables/useServerApi'
import { ModelCreationFormDraft } from '../../../forms/model'
import { ModelProviderFormDraft } from '../../../forms/model-provider'
import { useToasts } from '../../../composables/toasts'
import { formatDate } from '../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const router = useRouter()
const modelProviderId = computed(() => route.params.modelProviderId as string)
const serverApi = useServerApi()
const toasts = useToasts()
const { portfolio } = useSelectedPortfolio()
const { queryKeys, invalidate } = useQueryCache()
const providerForm = new ModelProviderFormDraft()
const modelCreationForm = new ModelCreationFormDraft()
const isProviderArchiveConfirmationVisible = ref(false)

const {
	data: provider,
	isLoading: isLoadingProvider,
	error: providerError,
	hasExecuted: hasLoadedProvider,
} = usePortfolioModelProviderQuery(serverApi, modelProviderId)
const { data: secrets } = usePortfolioSecretsQuery(serverApi)

const secretOptions = computed(() =>
	secrets.value.filter((secret) => !secret.archived).map((secret) => ({ value: secret.id, label: secret.name })),
)
const authSecretOptions = computed(() => [{ value: '', label: 'No auth Secret' }, ...secretOptions.value])

watch(
	provider,
	(loadedProvider) => {
		if (loadedProvider === null) return
		providerForm.loadEntity({
			name: loadedProvider.name,
			protocol: loadedProvider.protocol,
			baseUrl: loadedProvider.baseUrl,
			auth: loadedProvider.auth,
			headers: loadedProvider.headers,
		})
	},
	{ immediate: true },
)

const {
	isLoading: isSavingProvider,
	error: saveProviderError,
	execute: saveProvider,
} = useApiAction(async () => {
	const { protocol: _protocol, ...input } = providerForm.toModel()
	const updated = await serverApi.updateModelProvider(modelProviderId.value, input)
	invalidateProviderQueries()
	toasts.success({ title: 'Model Provider saved.', body: updated.name })
})

const {
	isLoading: isChangingProviderLifecycle,
	error: providerLifecycleError,
	execute: runProviderLifecycle,
} = useApiAction(async (action: 'archive' | 'unarchive') => {
	const updated =
		action === 'archive'
			? await serverApi.archiveModelProvider(modelProviderId.value)
			: await serverApi.unarchiveModelProvider(modelProviderId.value)
	isProviderArchiveConfirmationVisible.value = false
	invalidateProviderQueries()
	toasts.success({ title: action === 'archive' ? 'Model Provider archived.' : 'Model Provider unarchived.', body: updated.name })
})

const {
	isLoading: isCreatingModel,
	error: createModelError,
	execute: createModel,
} = useApiAction(async () => {
	const model = await serverApi.createModel(modelProviderId.value, modelCreationForm.toModel())
	modelCreationForm.reset()
	invalidateProviderQueries()
	toasts.success({ title: 'Model added.', body: model.name })
	await router.push(`/models/providers/${modelProviderId.value}/models/${model.id}`)
})

function invalidateProviderQueries(): void {
	invalidate(queryKeys.portfolio.modelProviders(portfolio.value.id), { exact: true })
	invalidate(queryKeys.portfolio.modelProvider(portfolio.value.id, modelProviderId.value), { exact: true })
}

function requestProviderArchive(): void {
	isProviderArchiveConfirmationVisible.value = true
}

function archiveProvider(): Promise<unknown> {
	return runProviderLifecycle('archive')
}

function unarchiveProvider(): Promise<unknown> {
	return runProviderLifecycle('unarchive')
}
</script>
