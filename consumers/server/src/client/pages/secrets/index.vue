<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 pt-3 pb-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Secrets</h1>
					<p class="m-0 mt-1 text-sz-helper text-dim">Create and inspect protected Secrets in the selected Portfolio.</p>
				</div>
				<NuxtLink
					class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast hover:brightness-110"
					to="/secrets/new">
					New Secret
				</NuxtLink>
			</div>
		</header>

		<section>
			<div v-if="isLoadingSecrets && !hasLoadedSecrets" class="border-b border-dimmer px-3 py-4 text-dim">Loading Secrets…</div>
			<div v-else-if="secretsError" class="border-b border-dimmer px-3 py-4 text-error">{{ secretsError }}</div>
			<div v-else-if="secrets.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Secrets yet.</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">Create a protected Secret before configuring Repository access.</p>
				<NuxtLink
					class="mt-4 inline-flex border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast"
					to="/secrets/new">
					Create your first Secret
				</NuxtLink>
			</div>
			<div v-else>
				<NuxtLink
					v-for="secret in secrets"
					:key="secret.id"
					:to="`/secrets/${secret.id}`"
					class="grid min-h-[52px] grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-b border-dimmer px-3 py-2 text-body hover:bg-card focus-visible:bg-secondary"
					:class="secret.archived ? 'opacity-50' : ''">
					<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">S</span>
					<span class="min-w-0">
						<strong class="block truncate font-semibold">{{ secret.name }}</strong>
						<span class="text-sz-helper text-dim">
							{{ secret.archived ? 'Archived · ' : '' }}Created {{ formatDate(secret.created.at) }}
						</span>
					</span>
				</NuxtLink>
			</div>
			<p v-if="isRefreshingSecrets" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">Refreshing Secrets…</p>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { useSecretsList } from '../../composables/portfolio/secrets'
import { formatDate } from '../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

const { secrets, isLoadingSecrets, secretsError, hasLoadedSecrets, isRefreshingSecrets } = useSecretsList()
</script>
