<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Models</h1>
					<p class="m-0 mt-1 text-sz-helper text-dim">Configure Model Providers and their selectable Models.</p>
				</div>
				<NuxtLink
					class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast hover:brightness-110"
					to="/models/providers/new">
					New Provider
				</NuxtLink>
			</div>
		</header>

		<section>
			<div v-if="isLoadingProviders && !hasLoadedProviders" class="border-b border-dimmer px-3 py-4 text-dim">
				Loading Model Providers…
			</div>
			<div v-else-if="providersError" class="border-b border-dimmer px-3 py-4 text-error">{{ providersError }}</div>
			<div v-else-if="providers.length === 0" class="border-b border-dimmer px-3 py-5">
				<UiCallout>There are no Model Providers yet. Create one, then add Models under it.</UiCallout>
			</div>
			<nav v-else class="border-t border-dimmer" aria-label="Model Providers">
				<NuxtLink
					v-for="provider in providers"
					:key="provider.id"
					:to="`/models/providers/${provider.id}`"
					class="grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-dimmer px-3 py-3 text-body hover:bg-card focus-visible:bg-secondary"
					:class="provider.archived ? 'opacity-50' : ''">
					<span class="min-w-0">
						<strong class="block truncate font-semibold">{{ provider.name }}</strong>
						<span class="mt-1 block truncate text-sz-helper text-dim">
							<span class="font-mono">{{ provider.protocol }}</span> · {{ provider.baseUrl }}
						</span>
					</span>
					<span class="self-center text-sz-helper text-dim"
						>{{ provider.models.length }} {{ modelCountLabel(provider.models.length) }}</span
					>
				</NuxtLink>
			</nav>
			<p v-if="isLoadingProviders && hasLoadedProviders" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Model Providers…
			</p>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
import UiCallout from '../../../components/ui/UiCallout.vue'
import { usePortfolioModelProvidersQuery } from '../../../composables/portfolio-resource-queries'
import { useServerApi } from '../../../composables/useServerApi'

definePageMeta({ middleware: ['has-selection'] })

const serverApi = useServerApi()
const {
	data: providers,
	isLoading: isLoadingProviders,
	error: providersError,
	hasExecuted: hasLoadedProviders,
} = usePortfolioModelProvidersQuery(serverApi)

function modelCountLabel(count: number): string {
	return count === 1 ? 'Model' : 'Models'
}
</script>
