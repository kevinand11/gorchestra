<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">New Model Provider</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Create a provider endpoint, then add Models from its detail page.</p>
		</header>

		<section class="border-b border-dimmer">
			<UiForm class="!gap-0" @submit.prevent="createProvider()">
				<section class="border-b border-dimmer px-3 py-3">
					<div class="grid gap-3 md:grid-cols-2">
						<UiFormGroup label="Provider name" for-id="provider-name" :error="providerForm.errors.name">
							<UiInput
								id="provider-name"
								v-model="providerForm.name"
								required
								placeholder="OpenAI production"
								:invalid="!!providerForm.errors.name" />
						</UiFormGroup>
						<UiFormGroup label="Protocol" for-id="provider-protocol" :error="providerForm.errors.protocol">
							<UiSelect
								id="provider-protocol"
								v-model="providerForm.protocol"
								:options="protocolOptions"
								placeholder="Select protocol"
								:invalid="!!providerForm.errors.protocol" />
						</UiFormGroup>
					</div>
					<div class="mt-3 grid gap-3">
						<UiFormGroup label="Base URL" for-id="provider-base-url" :error="providerForm.errors.baseUrl">
							<UiInput
								id="provider-base-url"
								v-model="providerForm.baseUrl"
								required
								placeholder="https://api.example.com"
								:invalid="!!providerForm.errors.baseUrl" />
						</UiFormGroup>
						<UiFormGroup label="API key Secret" for-id="provider-auth-secret" :error="providerForm.errors.authSecretId">
							<UiSelect
								id="provider-auth-secret"
								v-model="providerForm.authSecretId"
								:options="authSecretOptions"
								placeholder="No auth Secret"
								:invalid="!!providerForm.errors.authSecretId" />
						</UiFormGroup>
					</div>
				</section>

				<section class="border-b border-dimmer">
					<div class="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
						<div>
							<h2 class="m-0 text-sz-subsection font-semibold">Custom headers</h2>
							<p class="m-0 mt-1 text-sz-helper text-dim">
								Header values are Secret-backed and never entered as plaintext here.
							</p>
						</div>
						<UiButton type="button" variant="secondary" @click="addHeader()">Add header</UiButton>
					</div>
					<div v-if="providerForm.headers.length === 0" class="border-t border-dimmer px-3 py-3 text-sz-helper text-dim">
						No custom headers configured.
					</div>
					<div v-else class="border-t border-dimmer">
						<div
							v-for="(header, index) in headerDrafts"
							:key="index"
							class="grid gap-3 border-b border-dimmer px-3 py-3 md:grid-cols-[1fr_1fr_auto]">
							<UiFormGroup label="Header name" :for-id="`provider-header-name-${index}`" :error="header.errors.name">
								<UiInput
									:id="`provider-header-name-${index}`"
									v-model="header.name"
									placeholder="X-Provider-Header"
									:invalid="!!header.errors.name" />
							</UiFormGroup>
							<UiFormGroup
								label="Header Secret"
								:for-id="`provider-header-secret-${index}`"
								:error="header.errors.valueSecretId">
								<UiSelect
									:id="`provider-header-secret-${index}`"
									v-model="header.valueSecretId"
									:options="headerSecretOptions"
									placeholder="Select Secret"
									:invalid="!!header.errors.valueSecretId" />
							</UiFormGroup>
							<div class="self-end">
								<UiButton type="button" variant="ghost" @click="removeHeader(index)">Remove</UiButton>
							</div>
						</div>
					</div>
				</section>

				<section class="px-3 py-3">
					<div class="flex flex-wrap items-center gap-2">
						<UiButton type="submit" :loading="isCreatingProvider" :disabled="!providerForm.valid">Create Provider</UiButton>
						<NuxtLink class="px-3 py-1.5 text-sz-helper font-semibold text-dim hover:text-body" to="/models/providers"
							>Cancel</NuxtLink
						>
					</div>
					<UiText v-if="createProviderError" tone="error">{{ createProviderError }}</UiText>
				</section>
			</UiForm>
		</section>

		<template #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Protocol</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Protocol is immutable after creation. Create a separate Model Provider if the endpoint uses a different provider
						protocol.
					</p>
				</section>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Endpoint</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						No default base URLs are prefilled. Enter the exact endpoint this Portfolio should use.
					</p>
				</section>
				<section class="px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Secrets</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Create Secrets first if this provider needs an API key or custom headers.
					</p>
					<NuxtLink class="mt-2 inline-flex text-sz-helper font-semibold text-primary hover:brightness-110" to="/secrets/new">
						New Secret
					</NuxtLink>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import UiButton from '../../../components/ui/UiButton.vue'
import UiForm from '../../../components/ui/UiForm.vue'
import UiFormGroup from '../../../components/ui/UiFormGroup.vue'
import UiInput from '../../../components/ui/UiInput.vue'
import UiSelect from '../../../components/ui/UiSelect.vue'
import UiText from '../../../components/ui/UiText.vue'
import { useApiAction } from '../../../composables/action-state'
import { usePortfolioSecretsQuery } from '../../../composables/portfolio-resource-queries'
import { useQueryCache } from '../../../composables/query-cache'
import { useSelectedPortfolio } from '../../../composables/selected-portfolio'
import { useServerApi, type ModelProviderProtocolType } from '../../../composables/useServerApi'
import { ModelProviderFormDraft } from '../../../forms/model-provider'
import { useToasts } from '../../../composables/toasts'

definePageMeta({ middleware: ['has-selection'] })

const protocolOptions: Array<{ value: ModelProviderProtocolType; label: string }> = [
	{ value: 'openai-responses', label: 'OpenAI Responses' },
	{ value: 'anthropic-messages', label: 'Anthropic Messages' },
	{ value: 'openai-completions', label: 'OpenAI Completions' },
	{ value: 'google-generative-ai', label: 'Google Generative AI' },
]

const serverApi = useServerApi()
const toasts = useToasts()
const { portfolio } = useSelectedPortfolio()
const { queryKeys, invalidate } = useQueryCache()
const providerForm = new ModelProviderFormDraft()
const { data: secrets } = usePortfolioSecretsQuery(serverApi)

const authSecretOptions = computed(() => [{ value: null, label: 'No auth Secret' }, ...secretOptions.value])
const headerSecretOptions = computed(() => secretOptions.value)
const headerDrafts = computed(() => [...providerForm.headers])
const secretOptions = computed(() =>
	secrets.value.filter((secret) => !secret.archived).map((secret) => ({ value: secret.id, label: secret.name })),
)

const {
	isLoading: isCreatingProvider,
	error: createProviderError,
	execute: createProvider,
} = useApiAction(async () => {
	const provider = await serverApi.createModelProvider(providerForm.toModel())
	invalidate(queryKeys.portfolio.modelProviders(portfolio.value.id), { exact: true })
	toasts.success({ title: 'Model Provider created.', body: provider.name })
	await navigateTo(`/models/providers/${provider.id}`)
})

function addHeader(): void {
	providerForm.headers.add()
}

function removeHeader(index: number): void {
	providerForm.headers.delete(index)
}
</script>
