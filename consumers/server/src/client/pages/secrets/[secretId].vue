<template>
	<SelectedPortfolioShell>
		<UiHero>
			<UiText as="p" tone="primary" class="font-bold uppercase tracking-[0.16em]">Secret Details</UiText>
			<UiHeading as="h1" size="hero">{{ secret?.name ?? 'Loading Secret…' }}</UiHeading>
			<UiText size="lede" tone="muted">Secret values are protected and cannot be viewed after creation.</UiText>
		</UiHero>

		<UiCard>
			<UiText v-if="isLoadingSecret && !hasLoadedSecret" tone="muted">Loading Secret…</UiText>
			<UiText v-else-if="secretError" tone="error">{{ secretError }}</UiText>
			<div v-else-if="secret" class="grid gap-3">
				<UiHeading as="h2" size="section">{{ secret.name }}</UiHeading>
				<UiText tone="muted">Secret id: {{ secret.id }}</UiText>
				<UiText :tone="secret.archived ? 'muted' : 'success'">{{ secret.archived ? 'Archived' : 'Active' }}</UiText>
				<UiText tone="muted">Created: {{ secret.created.at }}</UiText>
				<UiText v-if="secret.replaced" tone="muted">Last replaced: {{ secret.replaced.at }}</UiText>
				<UiText tone="info" size="helper">Plaintext Secret values are never returned by the Server API.</UiText>
				<NuxtLink
					class="inline-flex w-fit items-center justify-center rounded-pill border border-dimmer bg-secondary px-5 py-3 font-extrabold text-secondary-contrast no-underline transition hover:border-primary"
					to="/secrets">
					Back to Secrets
				</NuxtLink>
			</div>
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
import { useServerApi, type ServerApi } from '../../composables/useServerApi'

definePageMeta({ middleware: ['has-selection'] })

type SecretDetails = Awaited<ReturnType<ServerApi['getSecret']>>

const route = useRoute()
const serverApi = useServerApi()
const secretId = computed(() => routeParam(route.params.secretId))
const secret = ref<SecretDetails | null>(null)

const {
	isLoading: isLoadingSecret,
	error: secretError,
	hasExecuted: hasLoadedSecret,
} = useFetchAction(
	async () => {
		secret.value = await serverApi.getSecret(secretId.value)
	},
	{ dedupeKey: `selected-portfolio-secret:${secretId.value}` },
)

function routeParam(value: string | string[]): string {
	return Array.isArray(value) ? (value[0] ?? '') : value
}
</script>
