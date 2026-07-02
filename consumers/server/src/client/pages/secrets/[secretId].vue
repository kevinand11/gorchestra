<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">{{ secret?.name ?? 'Loading Secret…' }}</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Secret values are protected and cannot be viewed after creation.</p>
		</header>

		<section>
			<div v-if="isLoadingSecret && !hasLoadedSecret" class="border-b border-dimmer px-3 py-4 text-dim">Loading Secret…</div>
			<p v-if="isLoadingSecret && hasLoadedSecret" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Secret…
			</p>
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
						<template v-for="reference in secret.references" :key="referenceKey(reference)">
							<NuxtLink
								v-if="isLinkedReference(reference)"
								:to="referenceLocation(reference)"
								class="block border-b border-dimmer px-3 py-2 text-body hover:bg-card focus-visible:bg-secondary"
								:class="reference.active ? '' : 'opacity-50'">
								<strong class="block truncate text-sz-helper font-semibold">{{ referenceTitle(reference) }}</strong>
								<span class="mt-1 block truncate text-sz-micro text-dim">{{ referenceSubtitle(reference) }}</span>
							</NuxtLink>
							<div v-else class="border-b border-dimmer px-3 py-2" :class="reference.active ? '' : 'opacity-50'">
								<strong class="block truncate text-sz-helper font-semibold">{{ referenceTitle(reference) }}</strong>
								<span class="mt-1 block truncate text-sz-micro text-dim">{{ referenceSubtitle(reference) }}</span>
							</div>
						</template>
					</div>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { useFetchAction } from '../../composables/action-state'
import { useQueryCache } from '../../composables/query-cache'
import { useSelectedPortfolio } from '../../composables/selected-portfolio'
import { useServerApi, type ServerApi } from '../../composables/useServerApi'
import { formatDate } from '../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type SecretDetails = Awaited<ReturnType<ServerApi['getSecret']>>
type SecretReference = SecretDetails['references'][number]
type LinkedSecretReference = Exclude<SecretReference, { type: 'secret-binding' }>

const route = useRoute()
const secretId = computed(() => route.params.secretId as string)
const { portfolio } = useSelectedPortfolio()
const portfolioId = computed(() => portfolio.value.id)
const serverApi = useServerApi()
const { queryKeys } = useQueryCache()

const {
	data: secret,
	isLoading: isLoadingSecret,
	error: secretError,
	hasExecuted: hasLoadedSecret,
} = useFetchAction(() => serverApi.getSecret(secretId.value), {
	queryKey: queryKeys.portfolio.secret(portfolioId.value, secretId.value),
	initialData: null as SecretDetails | null,
})

type SecretReferenceReader<T> = {
	[ReferenceType in SecretReference['type']]: (reference: Extract<SecretReference, { type: ReferenceType }>) => T
}

const referenceTitleByType: SecretReferenceReader<string> = {
	'repository-access': (reference) => `${reference.owner}/${reference.name}`,
	'model-provider-auth': (reference) => reference.name,
	'model-provider-header': (reference) => `${reference.name} · ${reference.headerName}`,
	'secret-binding': (reference) => reference.envName,
}

const referenceSubtitleByType: SecretReferenceReader<string> = {
	'repository-access': () => 'GitHub Repository access',
	'model-provider-auth': (reference) => `${modelProviderProtocolLabel(reference.protocol.type)} API key`,
	'model-provider-header': (reference) => `${modelProviderProtocolLabel(reference.protocol.type)} custom header`,
	'secret-binding': (reference) => `${secretBindingScopeLabel(reference.scope)} environment variable`,
}

const referenceKeyByType: SecretReferenceReader<string> = {
	'repository-access': (reference) => `${reference.type}:${reference.repositoryId}`,
	'model-provider-auth': (reference) => `${reference.type}:${reference.modelProviderId}`,
	'model-provider-header': (reference) => `${reference.type}:${reference.modelProviderId}:${reference.headerName}`,
	'secret-binding': (reference) => `${reference.type}:${reference.secretBindingId}`,
}

const modelProviderProtocolLabels: Record<string, string> = {
	'anthropic-messages': 'Anthropic Messages',
	'openai-responses': 'OpenAI Responses',
	'openai-completions': 'OpenAI Completions',
	'google-generative-ai': 'Google Generative AI',
}

function isLinkedReference(reference: SecretReference): reference is LinkedSecretReference {
	return reference.type !== 'secret-binding'
}

function referenceLocation(reference: LinkedSecretReference): string {
	switch (reference.type) {
		case 'repository-access':
			return `/projects/${reference.projectId}/repositories/${reference.repositoryId}`
		case 'model-provider-auth':
		case 'model-provider-header':
			return `/models/providers/${reference.modelProviderId}`
	}
}

function referenceTitle(reference: SecretReference): string {
	return referenceTitleByType[reference.type](reference as never)
}

function referenceSubtitle(reference: SecretReference): string {
	return referenceSubtitleByType[reference.type](reference as never)
}

function referenceKey(reference: SecretReference): string {
	return referenceKeyByType[reference.type](reference as never)
}

function modelProviderProtocolLabel(protocol: string): string {
	return modelProviderProtocolLabels[protocol] ?? protocol
}

function secretBindingScopeLabel(scope: Extract<SecretReference, { type: 'secret-binding' }>['scope']): string {
	switch (scope.type) {
		case 'portfolio':
			return 'Portfolio-scoped'
		case 'project':
			return 'Project-scoped'
		case 'delivery':
			return 'Delivery-scoped'
	}
}
</script>
