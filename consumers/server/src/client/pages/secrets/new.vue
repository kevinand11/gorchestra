<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">New Secret</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Store a protected value for future Repository or provider access.</p>
		</header>

		<section class="px-3 py-3">
			<UiForm @submit.prevent="createSecret()">
				<UiFormGroup label="Secret name" for-id="secret-name" :error="secretCreationForm.errors.name">
					<UiInput
						id="secret-name"
						v-model="secretCreationForm.name"
						required
						placeholder="GitHub PAT"
						:invalid="!!secretCreationForm.errors.name" />
				</UiFormGroup>
				<UiFormGroup label="Secret value" for-id="secret-value" :error="secretCreationForm.errors.value">
					<UiInput
						id="secret-value"
						v-model="secretCreationForm.value"
						type="password"
						required
						autocomplete="off"
						placeholder="Paste the Secret value"
						:invalid="!!secretCreationForm.errors.value" />
				</UiFormGroup>
				<UiText tone="muted" size="helper">Secret values cannot be viewed again after creation.</UiText>
				<div class="flex flex-wrap items-center gap-2">
					<UiButton type="submit" :loading="isCreatingSecret" :disabled="!secretCreationForm.valid">Create Secret</UiButton>
				</div>
				<UiText v-if="createSecretError" tone="error">{{ createSecretError }}</UiText>
			</UiForm>
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
import UiForm from '../../components/ui/UiForm.vue'
import UiFormGroup from '../../components/ui/UiFormGroup.vue'
import UiInput from '../../components/ui/UiInput.vue'
import UiText from '../../components/ui/UiText.vue'
import { useSelectedPortfolio } from '../../composables/auth/session'
import { useSecretsCreate } from '../../composables/portfolio/secrets'

definePageMeta({ middleware: ['has-selection'] })

const { portfolio } = useSelectedPortfolio()
const { secretCreationForm, isCreatingSecret, createSecretError, createSecret } = useSecretsCreate({
	onSuccess: async (secret) => {
		await navigateTo(`/secrets/${secret.id}`)
	},
})
</script>
