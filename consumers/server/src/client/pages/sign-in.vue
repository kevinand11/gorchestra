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
					<UiInput v-model="email" type="email" autocomplete="email" required placeholder="person@example.com" />
				</label>
				<UiButton type="submit" :loading="isRequestingEmailOtp">Send sign-in code</UiButton>
				<UiText v-if="requestEmailOtpError" tone="error">{{ requestEmailOtpError }}</UiText>
			</form>

			<form v-if="challengeRequested" class="mt-6 grid max-w-[520px] gap-4" @submit.prevent="verifyEmailOtp()">
				<label class="grid gap-2 font-bold text-dim">
					Six-digit code
					<UiInput v-model="code" inputmode="numeric" autocomplete="one-time-code" required placeholder="123456" />
				</label>
				<UiButton type="submit" :loading="isVerifyingEmailOtp">Verify and continue</UiButton>
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

const email = ref('')
const code = ref('')
const challengeRequested = ref(false)

const {
	isLoading: isRequestingEmailOtp,
	error: requestEmailOtpError,
	execute: requestEmailOtp,
} = useApiAction(async () => {
	await sessionStore.requestEmailOtp(email.value)
	challengeRequested.value = true
	toastStore.success({ title: 'Sign-in code sent.', body: 'Check your email for the six-digit code.' })
})

const {
	isLoading: isVerifyingEmailOtp,
	error: verifyEmailOtpError,
	execute: verifyEmailOtp,
} = useApiAction(async () => {
	await sessionStore.verifyEmailOtpSignIn(email.value, code.value)
	code.value = ''
	challengeRequested.value = false
	await navigateTo(sessionStore.homePath)
})
</script>
