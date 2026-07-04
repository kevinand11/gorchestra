<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">New Model Provider</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Create a provider endpoint, then add Models from its detail page.</p>
		</header>

		<section class="border-b border-dimmer">
			<UiForm class="gap-0!" @submit.prevent="createProvider()">
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
						<UiFormGroup label="Source" for-id="provider-source" :error="providerForm.errors.sourceType">
							<UiSelect
								id="provider-source"
								v-model="providerForm.sourceType"
								:options="sourceOptions"
								placeholder="Select source"
								:invalid="!!providerForm.errors.sourceType" />
						</UiFormGroup>
					</div>
					<div class="mt-3 grid gap-3">
						<template v-if="providerForm.sourceType === 'custom-hosted'">
							<UiFormGroup label="Custom protocol" for-id="provider-protocol" :error="providerForm.errors.customProtocol">
								<UiSelect
									id="provider-protocol"
									v-model="providerForm.customProtocol"
									:options="protocolOptions"
									placeholder="Select protocol"
									:invalid="!!providerForm.errors.customProtocol" />
							</UiFormGroup>
							<UiFormGroup label="Base URL" for-id="provider-base-url" :error="providerForm.errors.customBaseUrl">
								<UiInput
									id="provider-base-url"
									v-model="providerForm.customBaseUrl"
									required
									placeholder="https://api.example.com/v1"
									:invalid="!!providerForm.errors.customBaseUrl" />
							</UiFormGroup>
						</template>
						<UiFormGroup label="API key Secret" for-id="provider-auth-secret" :error="providerForm.errors.authSecretId">
							<UiSelect
								id="provider-auth-secret"
								v-model="providerForm.authSecretId"
								:options="authSecretOptions"
								placeholder="No auth Secret"
								:invalid="!!providerForm.errors.authSecretId" />
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
						<UiButton type="button" variant="secondary" @click="providerForm.headers.add()">Add header</UiButton>
					</div>
					<div v-if="providerForm.headers.length === 0" class="border-t border-dimmer px-3 py-3 text-sz-helper text-dim">
						No custom headers configured.
					</div>
					<div v-else class="border-t border-dimmer">
						<div
							v-for="(header, index) in providerForm.headers"
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
								<UiButton type="button" variant="ghost" @click="providerForm.headers.delete(index)">Remove</UiButton>
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
import UiTextarea from '../../../components/ui/UiTextarea.vue'
import type { ModelProviderProtocolType } from '../../../composables/core/server-api'
import type { ModelProviderSourceType } from '../../../forms/model-provider'
import { useModelProviderCreate } from '../../../composables/portfolio/models/providers'
import { useActiveSecretSelectOptions } from '../../../composables/portfolio/secrets'

definePageMeta({ middleware: ['has-selection'] })

const sourceOptions: Array<{ value: ModelProviderSourceType; label: string }> = [
	{ value: 'openai-responses', label: 'OpenAI Responses' },
	{ value: 'anthropic', label: 'Anthropic' },
	{ value: 'google', label: 'Google Generative AI' },
	{ value: 'groq', label: 'Groq' },
	{ value: 'custom-hosted', label: 'Custom hosted' },
]

const protocolOptions: Array<{ value: ModelProviderProtocolType; label: string }> = [
	{ value: 'openai-responses', label: 'OpenAI Responses' },
	{ value: 'openai-chat-completions', label: 'OpenAI Chat Completions' },
	{ value: 'anthropic-messages', label: 'Anthropic Messages' },
	{ value: 'google-generative-ai', label: 'Google Generative AI' },
]

const { providerForm, isCreatingProvider, createProviderError, createProvider } = useModelProviderCreate({
	onSuccess: async (provider) => {
		await navigateTo(`/models/providers/${provider.id}`)
	},
})
const { activeSecretOptions: secretOptions } = useActiveSecretSelectOptions()

const authSecretOptions = computed(() => [{ value: null, label: 'No auth Secret' }, ...secretOptions.value])
const headerSecretOptions = computed(() => secretOptions.value)
</script>
