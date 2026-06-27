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
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">References</span><span>{{ referenceCountLabel(secret.references.length) }}</span>
						</div>
					</div>
				</div>
				<div class="px-3 py-3">
					<div class="border border-dimmer bg-card p-3">
						<strong class="block font-semibold">Plaintext is not available here.</strong>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Use this page to inspect metadata and references. Create a replacement Secret when the value needs to change.
						</p>
					</div>
				</div>
			</div>
		</section>

		<template v-if="secret" #right>
			<aside class="grid gap-4 p-3">
				<div>
					<h2 class="m-0 text-sz-subsection font-semibold">References</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						{{ referenceCountLabel(secret.references.length) }} point to this Secret across Core-owned usages.
					</p>
				</div>

				<div v-if="secret.references.length === 0" class="border border-dashed border-dimmer p-3 text-sz-helper text-dim">
					No Repositories, Model Providers, or Secret Bindings reference this Secret.
				</div>

				<section v-for="group in visibleReferenceGroups" :key="group.key" class="grid gap-2">
					<div class="flex items-center justify-between gap-2">
						<h3 class="m-0 text-sz-helper font-semibold text-body">{{ group.title }}</h3>
						<span class="text-sz-micro text-dim">{{ group.references.length }}</span>
					</div>
					<div class="grid gap-2">
						<NuxtLink
							v-for="reference in group.linkedReferences"
							:key="referenceKey(reference)"
							:to="`/projects/${reference.projectId}/repositories/${reference.repositoryId}`"
							class="block border border-dimmer bg-card p-2 text-body hover:border-primary hover:bg-secondary">
							<span class="flex items-center justify-between gap-2">
								<strong class="min-w-0 truncate text-sz-helper font-semibold">{{ referenceTitle(reference) }}</strong>
								<span :class="referenceBadgeClass(reference)">{{ referenceStatusLabel(reference) }}</span>
							</span>
							<span class="mt-1 block text-sz-micro text-dim">{{ referenceSubtitle(reference) }}</span>
						</NuxtLink>

						<div
							v-for="reference in group.staticReferences"
							:key="referenceKey(reference)"
							class="border border-dimmer bg-card p-2">
							<span class="flex items-center justify-between gap-2">
								<strong class="min-w-0 truncate text-sz-helper font-semibold">{{ referenceTitle(reference) }}</strong>
								<span :class="referenceBadgeClass(reference)">{{ referenceStatusLabel(reference) }}</span>
							</span>
							<span class="mt-1 block text-sz-micro text-dim">{{ referenceSubtitle(reference) }}</span>
						</div>
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
type LinkedSecretReference = Extract<SecretReference, { type: 'repository-access' }>
type StaticSecretReference = Exclude<SecretReference, LinkedSecretReference>
type ReferenceGroupKey = 'repositories' | 'model-providers' | 'secret-bindings'
type ReferenceGroup = {
	key: ReferenceGroupKey
	title: string
	references: SecretReference[]
	linkedReferences: LinkedSecretReference[]
	staticReferences: StaticSecretReference[]
}

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

const referenceGroupDefinitions: Array<{
	key: ReferenceGroupKey
	title: string
	matches: (reference: SecretReference) => boolean
}> = [
	{ key: 'repositories', title: 'Repositories', matches: (reference) => reference.type === 'repository-access' },
	{
		key: 'model-providers',
		title: 'Model Providers',
		matches: (reference) => reference.type === 'model-provider-auth' || reference.type === 'model-provider-header',
	},
	{ key: 'secret-bindings', title: 'Secret Bindings', matches: (reference) => reference.type === 'secret-binding' },
]

const visibleReferenceGroups = computed<ReferenceGroup[]>(() =>
	referenceGroupDefinitions
		.map((group) =>
			referenceGroup(group.key, group.title, sortReferencesForDisplay((secret.value?.references ?? []).filter(group.matches))),
		)
		.filter((group) => group.references.length > 0),
)

function referenceGroup(key: ReferenceGroupKey, title: string, references: SecretReference[]): ReferenceGroup {
	return {
		key,
		title,
		references,
		linkedReferences: references.filter(isLinkedReference),
		staticReferences: references.filter((reference): reference is StaticSecretReference => !isLinkedReference(reference)),
	}
}

function isLinkedReference(reference: SecretReference): reference is LinkedSecretReference {
	return reference.type === 'repository-access'
}

function referenceCountLabel(count: number): string {
	return `${count} ${count === 1 ? 'reference' : 'references'}`
}

function sortReferencesForDisplay(references: SecretReference[]): SecretReference[] {
	return [...references].sort(
		(left, right) =>
			referenceArchiveRank(left) - referenceArchiveRank(right) ||
			referenceTitle(left).localeCompare(referenceTitle(right)) ||
			left.created.at.localeCompare(right.created.at) ||
			referenceKey(left).localeCompare(referenceKey(right)),
	)
}

function referenceArchiveRank(reference: SecretReference): number {
	return 'archived' in reference && reference.archived ? 1 : 0
}

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
	'model-provider-auth': (reference) => `${modelProviderProtocolLabel(reference.protocol)} API key`,
	'model-provider-header': (reference) => `${modelProviderProtocolLabel(reference.protocol)} custom header`,
	'secret-binding': (reference) => `${secretBindingScopeLabel(reference.scope)} environment variable`,
}

function referenceTitle(reference: SecretReference): string {
	return referenceTitleByType[reference.type](reference as never)
}

function referenceSubtitle(reference: SecretReference): string {
	return referenceSubtitleByType[reference.type](reference as never)
}

function referenceStatusLabel(reference: SecretReference): string {
	return referenceArchiveRank(reference) === 1 ? 'archived' : 'active'
}

function referenceBadgeClass(reference: SecretReference): string {
	return referenceArchiveRank(reference) === 1
		? 'shrink-0 border border-dimmer bg-secondary px-1.5 py-0.5 text-sz-micro font-semibold text-dim'
		: 'shrink-0 border border-success/50 bg-success/10 px-1.5 py-0.5 text-sz-micro font-semibold text-success'
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
