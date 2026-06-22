<template>
	<SelectedPortfolioShell>
		<UiHero>
			<UiText as="p" tone="primary" class="font-bold uppercase tracking-[0.16em]">Selected Portfolio</UiText>
			<UiHeading as="h1" size="hero">Secrets</UiHeading>
			<UiText size="lede" tone="muted">Create and inspect protected Secrets in the selected Portfolio.</UiText>
		</UiHero>

		<UiCard>
			<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
				<UiHeading as="h2" size="section">Secrets</UiHeading>
				<NuxtLink
					class="inline-flex items-center justify-center rounded-pill bg-primary px-5 py-3 font-extrabold text-primary-contrast no-underline transition hover:brightness-110"
					to="/secrets/new">
					New Secret
				</NuxtLink>
			</div>
			<UiText v-if="isLoadingSecrets && !hasLoadedSecrets" tone="muted">Loading Secrets…</UiText>
			<UiText v-else-if="secretsError" tone="error">{{ secretsError }}</UiText>
			<div v-else-if="secrets.length === 0" class="grid gap-3">
				<UiText tone="muted">No Secrets yet.</UiText>
				<NuxtLink
					class="inline-flex w-fit items-center justify-center rounded-pill bg-primary px-5 py-3 font-extrabold text-primary-contrast no-underline transition hover:brightness-110"
					to="/secrets/new">
					Create your first Secret
				</NuxtLink>
			</div>
			<ul v-else class="grid list-none gap-3 p-0">
				<li
					v-for="secret in secrets"
					:key="secret.id"
					class="flex items-center justify-between gap-3 rounded-list-item border border-dimmer bg-dimmer p-3.5">
					<div>
						<strong>{{ secret.name }}</strong>
						<UiText as="span" tone="muted">Secret id: {{ secret.id }}</UiText>
						<UiText as="span" :tone="secret.archived ? 'muted' : 'success'">
							{{ secret.archived ? 'Archived' : 'Active' }}
						</UiText>
					</div>
					<NuxtLink
						class="inline-flex items-center justify-center rounded-pill border border-dimmer bg-secondary px-4 py-2.5 font-extrabold text-secondary-contrast no-underline transition hover:border-primary"
						:to="`/secrets/${secret.id}`">
						Details
					</NuxtLink>
				</li>
			</ul>
			<UiText v-if="isLoadingSecrets && hasLoadedSecrets" tone="muted" size="helper">Refreshing Secrets…</UiText>
		</UiCard>
	</SelectedPortfolioShell>
</template>

<script setup lang="ts">
import SelectedPortfolioShell from '../../components/SelectedPortfolioShell.vue'
import UiCard from '../../components/ui/UiCard.vue'
import UiHeading from '../../components/ui/UiHeading.vue'
import UiHero from '../../components/ui/UiHero.vue'
import UiText from '../../components/ui/UiText.vue'
import { useFetchAction } from '../../composables/action-state'
import { useQueryCache } from '../../composables/query-cache'
import { useSelectedPortfolio } from '../../composables/selected-portfolio'
import { useServerApi, type ServerApi } from '../../composables/useServerApi'

definePageMeta({ middleware: ['has-selection'] })

type ListedSecret = Awaited<ReturnType<ServerApi['listSecrets']>>[number]

const selectedPortfolio = useSelectedPortfolio()
const serverApi = useServerApi()
const { queryKeys } = useQueryCache()
const portfolioId = computed(() => selectedPortfolio.value.portfolio.id)
const {
	data: secrets,
	isLoading: isLoadingSecrets,
	error: secretsError,
	hasExecuted: hasLoadedSecrets,
} = useFetchAction(() => serverApi.listSecrets(), {
	queryKey: queryKeys.portfolio.secrets(portfolioId.value),
	initialData: [] as ListedSecret[],
})
</script>
