<template>
	<main class="shell">
		<section class="hero">
			<p class="eyebrow">Gorchestra Server Consumer</p>
			<h1>Sign in with Email OTP.</h1>
			<p>Verify control of your email address before selecting a Workspace and Portfolio.</p>
		</section>

		<section class="card">
			<h2>Email OTP Sign-in</h2>
			<form class="stack" @submit.prevent="requestEmailOtp()">
				<label>
					Email address
					<input v-model="email" type="email" autocomplete="email" required placeholder="person@example.com" />
				</label>
				<button type="submit" :disabled="isRequestingEmailOtp">Send sign-in code</button>
				<p v-if="requestEmailOtpError" class="error">{{ requestEmailOtpError }}</p>
			</form>

			<form v-if="challengeRequested" class="stack" @submit.prevent="verifyEmailOtp()">
				<label>
					Six-digit code
					<input v-model="code" inputmode="numeric" autocomplete="one-time-code" required placeholder="123456" />
				</label>
				<button type="submit" :disabled="isVerifyingEmailOtp">Verify and continue</button>
				<p v-if="verifyEmailOtpError" class="error">{{ verifyEmailOtpError }}</p>
			</form>
		</section>
	</main>
</template>

<script setup lang="ts">
import { useApiAction } from '../composables/action-state'
import { useSessionStore } from '../stores/session'

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
