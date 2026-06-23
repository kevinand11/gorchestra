<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 pt-3 pb-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Secrets</h1>
					<p class="m-0 mt-1 text-sz-helper text-dim">Create and inspect protected Secrets in the selected Portfolio.</p>
				</div>
				<NuxtLink
					class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast no-underline hover:brightness-110"
					to="/secrets/new">
					New Secret
				</NuxtLink>
			</div>
		</header>

		<div class="flex min-h-11 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
			<div class="flex overflow-hidden border border-dimmer">
				<NuxtLink
					v-for="(tab, index) in secretTabs"
					:key="tab.value"
					:to="secretTabLocation(tab.value)"
					class="px-2 py-1 text-sz-helper no-underline"
					:class="[secretFilterPillClass(tab.value), index === secretTabs.length - 1 ? '' : 'border-r border-dimmer']">
					{{ tab.shortLabel }}
				</NuxtLink>
			</div>
			<span class="text-sz-helper text-dim"
				>{{ visibleSecrets.length }} {{ visibleSecrets.length === 1 ? 'Secret' : 'Secrets' }}</span
			>
		</div>

		<section>
			<div v-if="isLoadingSecrets && !hasLoadedSecrets" class="border-b border-dimmer px-3 py-4 text-dim">Loading Secrets…</div>
			<div v-else-if="secretsError" class="border-b border-dimmer px-3 py-4 text-error">{{ secretsError }}</div>
			<div v-else-if="secrets.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Secrets yet.</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">Create a protected Secret before configuring Repository access.</p>
				<NuxtLink
					class="mt-4 inline-flex border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast no-underline"
					to="/secrets/new">
					Create your first Secret
				</NuxtLink>
			</div>
			<div v-else-if="visibleSecrets.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Secrets match {{ currentSecretTabLabel }}.</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">Change the filter to inspect another Secret slice.</p>
				<NuxtLink
					class="mt-4 inline-flex border border-dimmer bg-secondary px-3 py-1.5 text-sz-helper font-semibold text-secondary-contrast no-underline"
					:to="secretTabLocation('all')">
					Show all Secrets
				</NuxtLink>
			</div>
			<div v-else>
				<NuxtLink
					v-for="secret in visibleSecrets"
					:key="secret.id"
					:to="`/secrets/${secret.id}`"
					class="grid min-h-[52px] grid-cols-[24px_minmax(0,1fr)_92px_110px] items-center gap-2 border-b border-dimmer px-3 py-2 text-body no-underline hover:bg-card focus-visible:bg-secondary">
					<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">S</span>
					<span class="min-w-0">
						<strong class="block truncate font-semibold">{{ secret.name }}</strong>
						<span class="text-sz-helper text-dim">Created {{ formatDate(secret.created.at) }}</span>
					</span>
					<span class="text-sz-helper text-dim">{{ referenceCountLabel(secret.references.length) }}</span>
					<span class="justify-self-start" :class="secret.archived ? archivedBadgeClass : activeBadgeClass">
						<span class="size-2 rounded-full" :class="secret.archived ? 'bg-dim' : 'bg-success'" />
						{{ secret.archived ? 'archived' : 'active' }}
					</span>
				</NuxtLink>
			</div>
			<p v-if="isLoadingSecrets && hasLoadedSecrets" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Secrets…
			</p>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { useFetchAction } from '../../composables/action-state'
import { useQueryCache } from '../../composables/query-cache'
import { useSelectedPortfolio } from '../../composables/selected-portfolio'
import { useServerApi, type ServerApi } from '../../composables/useServerApi'
import { formatDate } from '../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type ListedSecret = Awaited<ReturnType<ServerApi['listSecrets']>>[number]
type SecretTab = 'all' | 'active' | 'archived'

const secretTabs: Array<{ value: SecretTab; label: string; shortLabel: string }> = [
	{ value: 'all', label: 'All Secrets', shortLabel: 'All' },
	{ value: 'active', label: 'Active', shortLabel: 'Active' },
	{ value: 'archived', label: 'Archived', shortLabel: 'Archived' },
]

const route = useRoute()
const { portfolio } = useSelectedPortfolio()
const portfolioId = computed(() => portfolio.value.id)
const serverApi = useServerApi()
const { queryKeys } = useQueryCache()
const {
	data: secrets,
	isLoading: isLoadingSecrets,
	error: secretsError,
	hasExecuted: hasLoadedSecrets,
} = useFetchAction(() => serverApi.listSecrets(), {
	queryKey: queryKeys.portfolio.secrets(portfolioId.value),
	initialData: [] as ListedSecret[],
})

const currentSecretTab = computed(() => parseSecretTab(route.query.tab))
const currentSecretTabLabel = computed(() => secretTabs.find((tab) => tab.value === currentSecretTab.value)?.label ?? 'All Secrets')
const visibleSecrets = computed(() => secrets.value.filter((secret) => matchesSecretTab(secret, currentSecretTab.value)))
const activeBadgeClass =
	'inline-flex items-center gap-1 border border-success/50 bg-success/10 px-2 py-0.5 text-sz-micro font-semibold text-success'
const archivedBadgeClass =
	'inline-flex items-center gap-1 border border-dimmer bg-secondary px-2 py-0.5 text-sz-micro font-semibold text-dim'

function secretTabLocation(tab: SecretTab) {
	return { path: route.path, query: { ...route.query, tab } }
}

function parseSecretTab(value: unknown): SecretTab {
	const tab = Array.isArray(value) ? value[0] : value
	return secretTabs.some((option) => option.value === tab) ? (tab as SecretTab) : 'all'
}

function matchesSecretTab(secret: ListedSecret, tab: SecretTab): boolean {
	if (tab === 'active') return !secret.archived
	if (tab === 'archived') return secret.archived
	return true
}

function referenceCountLabel(count: number): string {
	return `${count} ${count === 1 ? 'ref' : 'refs'}`
}

function secretFilterPillClass(tab: SecretTab): string {
	return currentSecretTab.value === tab ? 'bg-card font-semibold text-body' : 'text-dim hover:bg-secondary hover:text-body'
}
</script>
