<template>
	<main class="shell">
		<section class="hero">
			<p class="eyebrow">Gorchestra Server Consumer</p>
			<h1>Sign in with Email OTP.</h1>
			<p>Verify control of your email address before selecting a Workspace and Portfolio.</p>
		</section>

		<section v-if="message" class="notice">{{ message }}</section>
		<section v-if="errorMessage" class="error">{{ errorMessage }}</section>

		<section class="card">
			<h2>Email OTP Sign-in</h2>
			<form class="stack" @submit.prevent="requestEmailOtp">
				<label>
					Email address
					<input v-model="email" type="email" autocomplete="email" required placeholder="person@example.com" />
				</label>
				<button type="submit" :disabled="busy">Send sign-in code</button>
			</form>

			<form v-if="challengeRequested" class="stack" @submit.prevent="verifyEmailOtp">
				<label>
					Six-digit code
					<input v-model="code" inputmode="numeric" autocomplete="one-time-code" required placeholder="123456" />
				</label>
				<button type="submit" :disabled="busy">Verify and continue</button>
			</form>
		</section>
	</main>
</template>

<script setup lang="ts">
const api = useServerApi()

const busy = ref(false)
const message = ref('')
const errorMessage = ref('')
const email = ref('')
const code = ref('')
const challengeRequested = ref(false)

async function requestEmailOtp(): Promise<void> {
	await runAction(async () => {
		await api.requestEmailOtp(email.value)
		challengeRequested.value = true
		message.value = 'Sign-in code sent. Check the server mail output for the development OTP.'
	})
}

async function verifyEmailOtp(): Promise<void> {
	await runAction(async () => {
		await api.verifyEmailOtpSignIn(email.value, code.value)
		code.value = ''
		challengeRequested.value = false
		message.value = 'Signed in.'
		await navigateTo('/')
	})
}

async function runAction(action: () => Promise<void>): Promise<void> {
	busy.value = true
	errorMessage.value = ''
	try {
		await action()
	} catch (error) {
		errorMessage.value = api.errorMessage(error)
	} finally {
		busy.value = false
	}
}
</script>
