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
							Use this page to inspect metadata. Create a replacement Secret when the value needs to change.
						</p>
					</div>
				</div>
			</div>
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

type SecretDetails = Awaited<ReturnType<ServerApi['getSecret']>>

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
</script>
