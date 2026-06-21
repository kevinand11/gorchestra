<template>
	<main class="shell">
		<section class="hero">
			<p class="eyebrow">Gorchestra Server Consumer</p>
			<h1>Sign in with Email OTP.</h1>
			<p>Verify control of your email address before selecting a Workspace and Portfolio.</p>
		</section>

		<section v-if="pageError" class="error">{{ pageError }}</section>

		<section class="card">
			<h2>Email OTP Sign-in</h2>
			<form class="stack" @submit.prevent="requestEmailOtpAction.execute()">
				<label>
					Email address
					<input v-model="email" type="email" autocomplete="email" required placeholder="person@example.com" />
				</label>
				<button type="submit" :disabled="isRequestingEmailOtp">Send sign-in code</button>
			</form>

			<form v-if="challengeRequested" class="stack" @submit.prevent="verifyEmailOtpAction.execute()">
				<label>
					Six-digit code
					<input v-model="code" inputmode="numeric" autocomplete="one-time-code" required placeholder="123456" />
				</label>
				<button type="submit" :disabled="isVerifyingEmailOtp">Verify and continue</button>
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

const requestEmailOtpAction = useApiAction(async () => {
	await sessionStore.requestEmailOtp(email.value)
	challengeRequested.value = true
})

const verifyEmailOtpAction = useApiAction(async () => {
	await sessionStore.verifyEmailOtpSignIn(email.value, code.value)
	code.value = ''
	challengeRequested.value = false
	await navigateTo(sessionStore.homePath)
})

const isRequestingEmailOtp = requestEmailOtpAction.isLoading
const isVerifyingEmailOtp = verifyEmailOtpAction.isLoading
const pageError = computed(() => requestEmailOtpAction.error.value || verifyEmailOtpAction.error.value)
</script>
