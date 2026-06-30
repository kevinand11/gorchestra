<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">New Secret</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Store a protected value for future Repository or provider access.</p>
		</header>

		<section class="px-3 py-3">
			<form class="grid max-w-[520px] gap-3" @submit.prevent="createSecret()">
				<label class="grid gap-1.5 font-semibold" for="secret-name">
					Secret name
					<UiInput
						id="secret-name"
						v-model="secretCreationForm.name"
						required
						placeholder="GitHub PAT"
						:invalid="!!secretCreationForm.errors.name" />
				</label>
				<UiText v-if="secretCreationForm.errors.name" tone="error" size="helper">
					{{ secretCreationForm.errors.name }}
				</UiText>
				<label class="grid gap-1.5 font-semibold" for="secret-value">
					Secret value
					<UiInput
						id="secret-value"
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
				<div class="flex flex-wrap items-center gap-2">
					<UiButton type="submit" :loading="isCreatingSecret" :disabled="!secretCreationForm.valid">Create Secret</UiButton>
				</div>
				<UiText v-if="createSecretError" tone="error">{{ createSecretError }}</UiText>
			</form>
		</section>

		<template #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Value handling</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">Cannot be viewed again</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">After creation, the browser only sees redacted Secret metadata.</p>
			</div>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">What gets created</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">An active Secret</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">The Secret can be selected when adding Repository access.</p>
			</div>
			<div class="px-3 py-3">
				<strong class="block font-semibold">Portfolio context</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">This Secret will belong to {{ portfolio.displayName }}.</p>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import UiButton from '../../components/ui/UiButton.vue'
import UiInput from '../../components/ui/UiInput.vue'
import UiText from '../../components/ui/UiText.vue'
import { useApiAction } from '../../composables/action-state'
import { useQueryCache } from '../../composables/query-cache'
import { useSelectedPortfolio } from '../../composables/selected-portfolio'
import { useServerApi } from '../../composables/useServerApi'
import { SecretCreationFormDraft } from '../../forms/secret'
import { useToasts } from '../../composables/toasts'

definePageMeta({ middleware: ['has-selection'] })

const { portfolio } = useSelectedPortfolio()
const serverApi = useServerApi()
const toasts = useToasts()
const { queryKeys, invalidate } = useQueryCache()
const secretCreationForm = new SecretCreationFormDraft()

const {
	isLoading: isCreatingSecret,
	error: createSecretError,
	execute: createSecret,
} = useApiAction(async () => {
	const secret = await serverApi.createSecret(secretCreationForm.toModel())
	invalidate(queryKeys.portfolio.secrets(portfolio.value.id), { exact: true })
	toasts.success({ title: 'Secret created.', body: secret.name })
	await navigateTo(`/secrets/${secret.id}`)
})
</script>
