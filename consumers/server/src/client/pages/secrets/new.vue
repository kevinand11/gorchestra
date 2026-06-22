<template>
	<SelectedPortfolioShell>
		<UiHero>
			<UiText as="p" tone="primary" class="font-bold uppercase tracking-[0.16em]">New Secret</UiText>
			<UiHeading as="h1" size="hero">Create a Secret.</UiHeading>
			<UiText size="lede" tone="muted">Store a protected value for future Repository or provider access.</UiText>
		</UiHero>

		<UiCard>
			<form class="grid max-w-[520px] gap-4" @submit.prevent="createSecret()">
				<label class="grid gap-2 font-bold text-dim">
					Secret name
					<UiInput
						v-model="secretCreationForm.name"
						required
						placeholder="GitHub PAT"
						:invalid="!!secretCreationForm.errors.name" />
				</label>
				<UiText v-if="secretCreationForm.errors.name" tone="error" size="helper">
					{{ secretCreationForm.errors.name }}
				</UiText>
				<label class="grid gap-2 font-bold text-dim">
					Secret value
					<UiInput
						v-model="secretCreationForm.value"
						type="password"
						required
						autocomplete="off"
						placeholder="Paste the Secret value"
						:invalid="!!secretCreationForm.errors.value" />
				</label>
				<UiText v-if="secretCreationForm.errors.value" tone="error" size="helper">
					{{ secretCreationForm.errors.value }}
				</UiText>
				<UiText tone="muted" size="helper">Secret values cannot be viewed again after creation.</UiText>
				<div class="flex flex-wrap items-center gap-3">
					<UiButton type="submit" :loading="isCreatingSecret" :disabled="!secretCreationForm.valid">Create Secret</UiButton>
					<NuxtLink
						class="inline-flex items-center justify-center rounded-pill border border-dimmer bg-secondary px-5 py-3 font-extrabold text-secondary-contrast no-underline transition hover:border-primary"
						to="/secrets">
						Back to Secrets
					</NuxtLink>
				</div>
				<UiText v-if="createSecretError" tone="error">{{ createSecretError }}</UiText>
			</form>
		</UiCard>
	</SelectedPortfolioShell>
</template>

<script setup lang="ts">
import SelectedPortfolioShell from '../../components/SelectedPortfolioShell.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiCard from '../../components/ui/UiCard.vue'
import UiHeading from '../../components/ui/UiHeading.vue'
import UiHero from '../../components/ui/UiHero.vue'
import UiInput from '../../components/ui/UiInput.vue'
import UiText from '../../components/ui/UiText.vue'
import { useApiAction } from '../../composables/action-state'
import { useQueryCache } from '../../composables/query-cache'
import { useSelectedPortfolio } from '../../composables/selected-portfolio'
import { useServerApi } from '../../composables/useServerApi'
import { SecretCreationFormFactory } from '../../forms/secret'
import { useToastStore } from '../../stores/toasts'

definePageMeta({ middleware: ['has-selection'] })

const selectedPortfolio = useSelectedPortfolio()
const serverApi = useServerApi()
const toastStore = useToastStore()
const queryCache = useQueryCache()
const { queryKeys } = queryCache
const secretCreationForm = new SecretCreationFormFactory()

const {
	isLoading: isCreatingSecret,
	error: createSecretError,
	execute: createSecret,
} = useApiAction(async () => {
	const secret = await serverApi.createSecret(secretCreationForm.toModel())
	queryCache.invalidate(queryKeys.portfolio.secrets(selectedPortfolio.value.portfolio.id), { exact: true })
	toastStore.success({ title: 'Secret created.', body: secret.name })
	await navigateTo(`/secrets/${secret.id}`)
})
</script>
