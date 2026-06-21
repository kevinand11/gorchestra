<template>
	<UiShell>
		<UiHero>
			<UiText as="p" tone="primary" class="font-bold uppercase tracking-[0.16em]">Gorchestra Server Consumer</UiText>
			<UiHeading as="h1" size="hero">Sign in with Email OTP.</UiHeading>
			<UiText size="lede" tone="muted">Verify control of your email address before selecting a Workspace and Portfolio.</UiText>
		</UiHero>

		<UiCard>
			<UiHeading as="h2" size="section" class="mb-4">Email OTP Sign-in</UiHeading>
			<form class="grid max-w-[520px] gap-4" @submit.prevent="requestEmailOtp()">
				<label class="grid gap-2 font-bold text-dim">
					Email address
					<UiInput
						v-model="emailOtpChallengeForm.email"
						type="email"
						autocomplete="email"
						required
						placeholder="person@example.com"
						:invalid="!!emailOtpChallengeForm.errors.email" />
				</label>
				<UiText v-if="emailOtpChallengeForm.errors.email" tone="error" size="helper">
					{{ emailOtpChallengeForm.errors.email }}
				</UiText>
				<UiButton type="submit" :loading="isRequestingEmailOtp" :disabled="!emailOtpChallengeForm.valid">
					Send sign-in code
				</UiButton>
				<UiText v-if="requestEmailOtpError" tone="error">{{ requestEmailOtpError }}</UiText>
			</form>

			<form v-if="challengeRequested" class="mt-6 grid max-w-[520px] gap-4" @submit.prevent="verifyEmailOtp()">
				<label class="grid gap-2 font-bold text-dim">
					Six-digit code
					<UiInput
						v-model="emailOtpVerificationForm.code"
						inputmode="numeric"
						autocomplete="one-time-code"
						required
						placeholder="123456"
						:invalid="!!emailOtpVerificationForm.errors.code" />
				</label>
				<UiText v-if="emailOtpVerificationForm.errors.code" tone="error" size="helper">
					{{ emailOtpVerificationForm.errors.code }}
				</UiText>
				<UiButton type="submit" :loading="isVerifyingEmailOtp" :disabled="!emailOtpVerificationForm.valid">
					Verify and continue
				</UiButton>
				<UiText v-if="verifyEmailOtpError" tone="error">{{ verifyEmailOtpError }}</UiText>
			</form>
		</UiCard>
	</UiShell>
</template>

<script setup lang="ts">
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiHeading from '../components/ui/UiHeading.vue'
import UiHero from '../components/ui/UiHero.vue'
import UiInput from '../components/ui/UiInput.vue'
import UiShell from '../components/ui/UiShell.vue'
import UiText from '../components/ui/UiText.vue'
import { useApiAction } from '../composables/action-state'
import { EmailOtpChallengeFormFactory, EmailOtpVerificationFormFactory } from '../forms/auth'
import { useSessionStore } from '../stores/session'
import { useToastStore } from '../stores/toasts'

definePageMeta({
	middleware: [
		async () => {
			const sessionStore = useSessionStore()
			await sessionStore.loadAuthenticatedState().catch()
			if (sessionStore.isAuthenticated) return sessionStore.homePath
		},
	],
})

const sessionStore = useSessionStore()
const toastStore = useToastStore()

const emailOtpChallengeForm = new EmailOtpChallengeFormFactory()
const emailOtpVerificationForm = new EmailOtpVerificationFormFactory()
const challengeRequested = ref(false)

watch(
	() => emailOtpChallengeForm.email,
	(email) => {
		emailOtpVerificationForm.email = email
	},
)

const {
	isLoading: isRequestingEmailOtp,
	error: requestEmailOtpError,
	execute: requestEmailOtp,
} = useApiAction(async () => {
	const input = emailOtpChallengeForm.toModel()
	await sessionStore.requestEmailOtp(input.email)
	emailOtpVerificationForm.loadEntity({ email: input.email, code: '' })
	challengeRequested.value = true
	toastStore.success({ title: 'Sign-in code sent.', body: 'Check your email for the six-digit code.' })
})

const {
	isLoading: isVerifyingEmailOtp,
	error: verifyEmailOtpError,
	execute: verifyEmailOtp,
} = useApiAction(async () => {
	const input = emailOtpVerificationForm.toModel()
	await sessionStore.verifyEmailOtpSignIn(input.email, input.code)
	emailOtpVerificationForm.code = ''
	challengeRequested.value = false
	await navigateTo(sessionStore.homePath)
})
</script>
