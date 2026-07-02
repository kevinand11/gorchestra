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
				<h2 class="m-0 text-sz-subsection font-semibold">No Model Providers yet.</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">Create one, then add Models under it from the provider detail page.</p>
			</div>
			<nav v-else class="border-t border-dimmer" aria-label="Model Providers">
				<NuxtLink
					v-for="provider in providers"
					:key="provider.id"
					:to="`/models/providers/${provider.id}`"
					class="grid min-h-[58px] grid-cols-[minmax(0,1fr)] gap-3 border-b border-dimmer px-3 py-3 text-body hover:bg-card focus-visible:bg-secondary"
					:class="provider.archived ? 'opacity-50' : ''">
					<span class="min-w-0">
						<strong class="block truncate font-semibold">{{ provider.name }}</strong>
						<span class="mt-1 block truncate text-sz-helper text-dim">
							<span class="font-mono">{{ provider.protocol.type }}</span> · {{ provider.baseUrl }}
						</span>
					</span>
				</NuxtLink>
			</nav>
			<p v-if="isRefreshingProviders" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Model Providers…
			</p>
		</section>

		<template #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Setup order</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Create a Model Provider first, then add Models from that provider's detail page.
					</p>
				</section>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Lifecycle actions</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Archive, unarchive, and Preflight actions live on provider detail pages, not on this index.
					</p>
				</section>
				<section class="px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Portfolio Config</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						After adding active Models, select defaults in Portfolio Config.
					</p>
					<NuxtLink
						class="mt-2 inline-flex text-sz-helper font-semibold text-primary hover:brightness-110"
						to="/portfolio-config">
						Open Portfolio Config
					</NuxtLink>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { useModelProvidersList } from '../../../composables/portfolio/models/providers'

definePageMeta({ middleware: ['has-selection'] })

const { providers, isLoadingProviders, providersError, hasLoadedProviders, isRefreshingProviders } = useModelProvidersList()
</script>
