<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">{{ secret?.name ?? 'Loading Secret…' }}</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Secret values are protected and cannot be viewed after creation.</p>
		</header>

		<section>
			<div v-if="isLoadingSecret && !hasLoadedSecret" class="border-b border-dimmer px-3 py-4 text-dim">Loading Secret…</div>
			<p v-if="isRefreshingSecret" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">Refreshing Secret…</p>
			<div v-else-if="secretError" class="border-b border-dimmer px-3 py-4 text-error">{{ secretError }}</div>
			<div v-else-if="secret" class="grid gap-0">
				<div class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Secret metadata</h2>
					<div class="mt-2 grid gap-2 text-sz-helper sm:grid-cols-2">
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Status</span
							><span :class="secret.archived ? 'text-dim' : 'text-success'">{{
								secret.archived ? 'Archived' : 'Active'
							}}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Created</span><span>{{ formatDate(secret.created.at) }}</span>
						</div>
						<div v-if="secret.replaced" class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Last replaced</span><span>{{ formatDate(secret.replaced.at) }}</span>
						</div>
					</div>
				</div>
				<div class="px-3 py-3">
					<div class="border border-dimmer bg-card p-3">
						<strong class="block font-semibold">Plaintext is not available here.</strong>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Use this page to inspect metadata and direct references. Create a replacement Secret when the value needs to
							change.
						</p>
					</div>
				</div>
			</div>
		</section>

		<template v-if="secret" #right>
			<aside>
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
import type { ServerApi } from '../../composables/core/server-api'
import { useSecretDetail } from '../../composables/portfolio/secrets'
import { formatDate } from '../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type SecretDetails = Awaited<ReturnType<ServerApi['getSecret']>>
type SecretReference = SecretDetails['references'][number]

const route = useRoute()
const secretId = computed(() => route.params.secretId as string)
const { secret, isLoadingSecret, secretError, hasLoadedSecret, isRefreshingSecret } = useSecretDetail(secretId)

const modelProviderProtocolLabels: Record<string, string> = {
	'anthropic-messages': 'Anthropic Messages',
	'openai-chat-completions': 'OpenAI Chat Completions',
	'openai-responses': 'OpenAI Responses',
	'google-generative-ai': 'Google Generative AI',
}

function referenceLocation(reference: SecretReference): string {
	switch (reference.type) {
		case 'repository-access':
			return `/projects/${reference.projectId}/repositories/${reference.repositoryId}`
		case 'agent-run-profile-environment-secret':
		case 'agent-run-profile-run-command-secret':
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
</script>
