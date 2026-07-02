<template>
	<NuxtLayout name="default" topbar-subtitle="Goal-oriented delivery orchestration">
		<section class="border-b border-dimmer px-3 py-3">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Sign in</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Verify your email address, then choose the Portfolio where the work lives.</p>
		</section>

		<section class="px-3 py-3">
			<UiForm class="max-w-[460px]" @submit.prevent="challengeRequested ? verifyEmailOtp() : requestEmailOtp()">
				<UiFormGroup for-id="email" :error="emailOtpChallengeForm.errors.email">
					<template #label>
						<UiLabel for="email">Email address</UiLabel>
					</template>
					<template #label-end>
						<span v-if="challengeRequested" class="font-mono text-sz-micro text-dim">code sent</span>
					</template>
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
					<template #helper>
						<UiText v-if="challengeRequested" tone="muted" size="helper">
							To edit this email address, choose Change email first. That resets the code step.
						</UiText>
					</template>
				</UiFormGroup>

				<div v-if="challengeRequested" class="grid gap-3 border border-dimmer bg-card p-3">
					<UiFormGroup label="Six-digit code" for-id="code" :error="emailOtpVerificationForm.errors.code">
						<UiInput
							id="code"
							v-model="emailOtpVerificationForm.code"
							inputmode="numeric"
							autocomplete="one-time-code"
							required
							placeholder="123456"
							:invalid="!!emailOtpVerificationForm.errors.code" />
					</UiFormGroup>
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
			</UiForm>
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
import UiForm from '../components/ui/UiForm.vue'
import UiFormGroup from '../components/ui/UiFormGroup.vue'
import UiInput from '../components/ui/UiInput.vue'
import UiLabel from '../components/ui/UiLabel.vue'
import UiText from '../components/ui/UiText.vue'
import { useEmailOtpSignIn } from '../composables/auth/sign-in'
import { isAuthenticatedSession, useAuthState } from '../composables/auth-state'

definePageMeta({
	middleware: [
		async () => {
			const authState = useAuthState()
			const session = await authState.getSession().catch(() => null)
			if (session !== null && isAuthenticatedSession(session)) return await authState.getHomePath()
		},
	],
})

const {
	emailOtpChallengeForm,
	emailOtpVerificationForm,
	challengeRequested,
	isRequestingEmailOtp,
	requestEmailOtpError,
	requestEmailOtp,
	isVerifyingEmailOtp,
	verifyEmailOtpError,
	verifyEmailOtp,
	changeEmail,
} = useEmailOtpSignIn({
	onSuccess: async () => {
		await navigateTo(await useAuthState().getHomePath())
	},
})
</script>
