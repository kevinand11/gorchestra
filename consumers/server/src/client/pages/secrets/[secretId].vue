<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">{{ secret?.name ?? 'Loading Secret…' }}</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Manage Secret Metadata, value replacement, and direct references.</p>
		</header>

		<section>
			<div v-if="isLoadingSecret && !hasLoadedSecret" class="border-b border-dimmer px-3 py-4 text-dim">Loading Secret…</div>
			<p v-if="isRefreshingSecret" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">Refreshing Secret…</p>
			<div v-else-if="secretError" class="border-b border-dimmer px-3 py-4 text-error">{{ secretError }}</div>
			<div v-else-if="secret" class="grid gap-0">
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Secret metadata</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Update non-sensitive Secret Metadata. Secret values are managed separately and cannot be viewed here.
					</p>
					<UiForm class="mt-3 grid gap-3" @submit.prevent="updateSecretMetadata()">
						<UiFormGroup label="Secret name" for-id="secret-name" :error="secretMetadataForm.errors.name">
							<UiInput id="secret-name" v-model="secretMetadataForm.name" :invalid="!!secretMetadataForm.errors.name" />
						</UiFormGroup>
						<div class="flex flex-wrap items-center gap-2">
							<UiButton
								type="submit"
								variant="secondary"
								:loading="isUpdatingSecretMetadata"
								:disabled="!secretMetadataForm.valid || !secretMetadataForm.dirty">
								Save Metadata
							</UiButton>
						</div>
						<UiText v-if="updateSecretMetadataError" tone="error">{{ updateSecretMetadataError }}</UiText>
					</UiForm>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Secret value</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						The plaintext value cannot be viewed after creation. Replacing it keeps this Secret identity and updates future
						Secret resolutions.
					</p>
					<div v-if="!showValueReplacementForm" class="mt-3">
						<UiButton type="button" variant="secondary" @click="showValueReplacementForm = true">Replace Secret Value</UiButton>
					</div>
					<UiForm v-else class="mt-3 grid gap-3" @submit.prevent="replaceSecretValue()">
						<UiText tone="muted" size="helper">
							Existing references will use the new value the next time Core resolves this Secret. Prepared Agent Runs or
							operations already in flight are not changed.
						</UiText>
						<UiFormGroup label="New Secret value" for-id="secret-value" :error="secretValueReplacementForm.errors.value">
							<UiInput
								id="secret-value"
								v-model="secretValueReplacementForm.value"
								type="password"
								autocomplete="off"
								placeholder="Paste the new Secret value"
								:invalid="!!secretValueReplacementForm.errors.value" />
						</UiFormGroup>
						<div class="flex flex-wrap items-center gap-2">
							<UiButton
								type="submit"
								variant="secondary"
								:loading="isReplacingSecretValue"
								:disabled="!secretValueReplacementForm.valid">
								Save New Value
							</UiButton>
							<UiButton
								type="button"
								variant="ghost"
								:disabled="isReplacingSecretValue"
								@click="cancelSecretValueReplacement()">
								Cancel
							</UiButton>
						</div>
						<UiText v-if="replaceSecretValueError" tone="error">{{ replaceSecretValueError }}</UiText>
					</UiForm>
				</section>
			</div>
		</section>

		<template v-if="secret" #right>
			<aside>
				<section class="border-b border-dimmer">
					<div class="px-3 py-3">
						<h2 class="m-0 text-sz-subsection font-semibold">Details</h2>
					</div>
					<dl class="m-0 text-sz-helper">
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<dt class="text-dim">Status</dt>
							<dd class="m-0" :class="secret.archived ? 'text-dim' : 'text-success'">
								{{ secret.archived ? 'Archived' : 'Active' }}
							</dd>
						</div>
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<dt class="text-dim">Created</dt>
							<dd class="m-0">{{ formatDate(secret.created.at) }}</dd>
						</div>
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<dt class="text-dim">Updated</dt>
							<dd class="m-0">{{ updatedLabel }}</dd>
						</div>
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<dt class="text-dim">Last value replacement</dt>
							<dd class="m-0">{{ valueReplacedLabel }}</dd>
						</div>
					</dl>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Archive</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Archiving prevents future use of this Secret while preserving existing references.
					</p>
					<div class="mt-3 grid gap-2">
						<UiButton
							v-if="secret.archived"
							type="button"
							variant="secondary"
							:loading="isChangingSecretLifecycle"
							@click="runSecretLifecycle('unarchive')">
							Unarchive Secret
						</UiButton>
						<UiButton v-else type="button" variant="ghost" :loading="isChangingSecretLifecycle" @click="requestSecretArchive()">
							Archive Secret
						</UiButton>
						<UiText v-if="secretLifecycleError" tone="error">{{ secretLifecycleError }}</UiText>
					</div>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">References</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Direct references show stored data models that can use this Secret in future. Plaintext values are never shown here.
					</p>
				</section>

				<section>
					<div v-if="secret.references.length === 0" class="border-b border-dimmer px-3 py-3 text-sz-helper text-dim">
						No direct references for this Secret.
					</div>
					<div v-else>
						<NuxtLink
							v-for="reference in secret.references"
							:key="referenceKey(reference)"
							:to="referenceLocation(reference)"
							class="block border-b border-dimmer px-3 py-2 text-body hover:bg-card focus-visible:bg-secondary"
							:class="reference.active ? '' : 'opacity-50'">
							<strong class="block truncate text-sz-helper font-semibold">{{ referenceTitle(reference) }}</strong>
							<span class="mt-1 block truncate text-sz-micro text-dim">{{ referenceSubtitle(reference) }}</span>
						</NuxtLink>
					</div>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { syncFormDraftFromEntity } from '@gorchestra/form-draft'
import { computed, ref } from 'vue'

import UiButton from '../../components/ui/UiButton.vue'
import UiForm from '../../components/ui/UiForm.vue'
import UiFormGroup from '../../components/ui/UiFormGroup.vue'
import UiInput from '../../components/ui/UiInput.vue'
import UiText from '../../components/ui/UiText.vue'
import { useOverlay } from '../../composables/core/overlay'
import type { ServerApi } from '../../composables/core/server-api'
import {
	useSecretDetail,
	useSecretLifecycleActions,
	useSecretMetadataUpdate,
	useSecretValueReplacement,
} from '../../composables/portfolio/secrets'
import { formatDate } from '../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type SecretDetails = Awaited<ReturnType<ServerApi['getSecret']>>
type SecretReference = SecretDetails['references'][number]

const route = useRoute()
const { confirm } = useOverlay()
const secretId = computed(() => route.params.secretId as string)
const showValueReplacementForm = ref(false)
const { secret, isLoadingSecret, secretError, hasLoadedSecret, isRefreshingSecret } = useSecretDetail(secretId)
const { secretMetadataForm, isUpdatingSecretMetadata, updateSecretMetadataError, updateSecretMetadata } = useSecretMetadataUpdate(secretId)
const { secretValueReplacementForm, isReplacingSecretValue, replaceSecretValueError, replaceSecretValue, resetReplaceSecretValue } =
	useSecretValueReplacement(secretId, {
		onSuccess: () => {
			showValueReplacementForm.value = false
		},
	})
const { isChangingSecretLifecycle, secretLifecycleError, runSecretLifecycle } = useSecretLifecycleActions(secretId)
const updatedLabel = computed(() =>
	secret.value?.updated === null || secret.value === null ? 'Never' : formatDate(secret.value.updated.at),
)
const valueReplacedLabel = computed(() =>
	secret.value?.valueReplaced === null || secret.value === null ? 'Never' : formatDate(secret.value.valueReplaced.at),
)

syncFormDraftFromEntity(() => (secret.value === null ? null : { name: secret.value.name }), secretMetadataForm)

const modelProviderProtocolLabels: Record<string, string> = {
	'anthropic-messages': 'Anthropic Messages',
	'openai-chat-completions': 'OpenAI Chat Completions',
	'openai-responses': 'OpenAI Responses',
	'google-generative-ai': 'Google Generative AI',
}

function cancelSecretValueReplacement(): void {
	secretValueReplacementForm.reset()
	resetReplaceSecretValue()
	showValueReplacementForm.value = false
}

async function requestSecretArchive(): Promise<void> {
	const confirmed = await confirm({
		title: 'Archive Secret?',
		body: 'Archiving prevents future use of this Secret while preserving existing references. Referencing configs may fail preflight or runtime resolution until the Secret is unarchived or replaced.',
		confirm: { label: 'Archive Secret', tone: 'danger' },
	})
	if (!confirmed) return
	await runSecretLifecycle('archive')
}

function referenceLocation(reference: SecretReference): string {
	switch (reference.type) {
		case 'repository-access':
			return `/projects/${reference.projectId}/repositories/${reference.repositoryId}`
		case 'agent-run-profile-environment-secret':
		case 'agent-run-profile-run-command-secret':
		case 'agent-run-profile-sandbox-credential':
			return `/agent-run-profiles/${reference.agentRunProfileId}`
		case 'model-provider-auth':
		case 'model-provider-header':
			return `/models/providers/${reference.modelProviderId}`
		default:
			throw new Error(`Unexpected linked Secret Reference type: ${String(reference satisfies never)}`)
	}
}

function referenceTitle(reference: SecretReference): string {
	switch (reference.type) {
		case 'repository-access':
			return `${reference.owner}/${reference.name}`
		case 'agent-run-profile-environment-secret':
			return `${reference.name} · ${reference.envName}`
		case 'agent-run-profile-run-command-secret':
			return `${reference.name} · ${reference.label}`
		case 'agent-run-profile-sandbox-credential':
			return `${reference.name} · ${sandboxCredentialLabel(reference.credential)}`
		case 'model-provider-auth':
			return reference.name
		case 'model-provider-header':
			return `${reference.name} · ${reference.headerName}`
		default:
			throw new Error(`Unexpected Secret Reference type: ${String(reference satisfies never)}`)
	}
}

function referenceSubtitle(reference: SecretReference): string {
	switch (reference.type) {
		case 'repository-access':
			return 'GitHub Repository access'
		case 'agent-run-profile-environment-secret':
			return 'Agent Run Profile environment Secret requirement'
		case 'agent-run-profile-run-command-secret':
			return `${reference.envName} command-scoped Secret for Run Command requirement`
		case 'agent-run-profile-sandbox-credential':
			return `${sandboxCredentialLabel(reference.credential)} Vercel sandbox credential`
		case 'model-provider-auth':
			return `${modelProviderProtocolLabel(reference.protocol)} API key`
		case 'model-provider-header':
			return `${modelProviderProtocolLabel(reference.protocol)} custom header`
		default:
			throw new Error(`Unexpected Secret Reference type: ${String(reference satisfies never)}`)
	}
}

function referenceKey(reference: SecretReference): string {
	switch (reference.type) {
		case 'repository-access':
			return `${reference.type}:${reference.repositoryId}`
		case 'agent-run-profile-environment-secret':
			return `${reference.type}:${reference.agentRunProfileId}:${reference.envName}`
		case 'agent-run-profile-run-command-secret':
			return `${reference.type}:${reference.agentRunProfileId}:${reference.label}:${reference.envName}`
		case 'agent-run-profile-sandbox-credential':
			return `${reference.type}:${reference.agentRunProfileId}:${reference.credential}`
		case 'model-provider-auth':
			return `${reference.type}:${reference.modelProviderId}`
		case 'model-provider-header':
			return `${reference.type}:${reference.modelProviderId}:${reference.headerName}`
		default:
			throw new Error(`Unexpected Secret Reference type: ${String(reference satisfies never)}`)
	}
}

function modelProviderProtocolLabel(protocol: string): string {
	return modelProviderProtocolLabels[protocol] ?? protocol
}

function sandboxCredentialLabel(credential: string): string {
	return (
		{
			'vercel-token': 'Vercel token',
			'vercel-team-id': 'Vercel team id',
			'vercel-project-id': 'Vercel project id',
		}[credential] ?? credential
	)
}
</script>
