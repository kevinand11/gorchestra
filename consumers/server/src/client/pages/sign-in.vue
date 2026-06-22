<template>
	<NuxtLayout name="default" topbar-subtitle="Goal-oriented delivery orchestration">
		<section class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Sign in</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Verify your email address, then choose the Portfolio where the work lives.</p>
		</section>

		<section class="px-3 py-3">
			<form class="grid max-w-[460px] gap-3" @submit.prevent="challengeRequested ? verifyEmailOtp() : requestEmailOtp()">
				<div class="grid gap-1.5">
					<div class="flex items-center justify-between gap-3">
						<label class="font-semibold" for="email">Email address</label>
						<span v-if="challengeRequested" class="font-mono text-sz-micro text-dim">code sent</span>
					</div>
					<div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
						<UiInput
							id="email"
							v-model="emailOtpChallengeForm.email"
							type="email"
							autocomplete="email"
							required
							placeholder="person@example.com"
							:disabled="challengeRequested"
							:invalid="!!emailOtpChallengeForm.errors.email" />
						<UiButton v-if="challengeRequested" type="button" variant="secondary" @click="changeEmail()">Change email</UiButton>
					</div>
					<UiText v-if="emailOtpChallengeForm.errors.email" tone="error" size="helper">
						{{ emailOtpChallengeForm.errors.email }}
					</UiText>
					<UiText v-if="challengeRequested" tone="muted" size="helper">
						To edit this email address, choose Change email first. That resets the code step.
					</UiText>
				</div>

				<div v-if="challengeRequested" class="grid gap-3 border border-dimmer bg-card p-3">
					<div class="grid gap-1.5">
						<label class="font-semibold" for="code">Six-digit code</label>
						<UiInput
							id="code"
							v-model="emailOtpVerificationForm.code"
							inputmode="numeric"
							autocomplete="one-time-code"
							required
							placeholder="123456"
							:invalid="!!emailOtpVerificationForm.errors.code" />
						<UiText v-if="emailOtpVerificationForm.errors.code" tone="error" size="helper">
							{{ emailOtpVerificationForm.errors.code }}
						</UiText>
					</div>
					<UiButton type="submit" :loading="isVerifyingEmailOtp" :disabled="!emailOtpVerificationForm.valid">
						Verify and continue
					</UiButton>
					<UiText v-if="verifyEmailOtpError" tone="error">{{ verifyEmailOtpError }}</UiText>
				</div>

				<div v-else class="grid justify-items-start gap-3">
					<UiButton type="submit" :loading="isRequestingEmailOtp" :disabled="!emailOtpChallengeForm.valid">
						Send sign-in code
					</UiButton>
					<UiText v-if="requestEmailOtpError" tone="error">{{ requestEmailOtpError }}</UiText>
				</div>
			</form>
		</section>

		<template #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Email sign-in</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">One-time code</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					Enter your email address and Gorchestra sends a short sign-in code to that inbox.
				</p>
			</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">Use the latest code</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					If you request another code, use the newest email before continuing.
				</p>
			</div>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">After sign-in</div>
			<div class="border-b border-dimmer px-3 py-3">
				<div class="border border-dimmer bg-canvas">
					<div class="border-b border-dimmer px-2.5 py-2 font-mono text-sz-micro text-dim">selected portfolio</div>
					<div class="grid gap-2 p-3">
						<div class="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 border-b border-dimmer pb-2">
							<span class="size-3.5 border border-dimmer" />
							<span
								><strong class="block text-sz-helper">Select a Portfolio</strong
								><span class="block text-sz-micro text-dim">Workspace / Default Portfolio</span></span
							>
							<span class="size-2 rounded-full bg-success" />
						</div>
						<div class="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 border-b border-dimmer pb-2">
							<span class="size-3.5 border border-dimmer" />
							<span
								><strong class="block text-sz-helper">Open a Project</strong
								><span class="block text-sz-micro text-dim">Repository setup hub</span></span
							>
							<span class="size-2 rounded-full bg-success" />
						</div>
						<div class="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2">
							<span class="size-3.5 border border-dimmer" />
							<span
								><strong class="block text-sz-helper">Check repository access</strong
								><span class="block text-sz-micro text-dim">Run Preflight when needed</span></span
							>
							<span class="size-2 rounded-full bg-primary" />
						</div>
					</div>
				</div>
			</div>
			<div class="px-3 py-3">
				<strong class="block font-semibold">Coordinate delivery work</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					Projects, Repositories, Secrets, and review decisions stay connected inside the selected Portfolio.
				</p>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import UiButton from '../components/ui/UiButton.vue'
import UiInput from '../components/ui/UiInput.vue'
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
		if (!challengeRequested.value) emailOtpVerificationForm.email = email
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

function changeEmail(): void {
	challengeRequested.value = false
	emailOtpVerificationForm.loadEntity({ email: emailOtpChallengeForm.email, code: '' })
}
</script>
