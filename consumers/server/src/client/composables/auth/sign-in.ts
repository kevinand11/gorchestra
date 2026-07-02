import { ref, watch } from 'vue'

import { EmailOtpChallengeFormDraft, EmailOtpVerificationFormDraft } from '../../forms/auth'
import { useApiAction } from '../action-state'
import { useAuthState } from '../auth-state'
import { useToasts } from '../toasts'

type EmailOtpSignInOptions = {
	onSuccess?: () => void | Promise<void>
}

export function useEmailOtpSignIn(options: EmailOtpSignInOptions = {}) {
	const authState = useAuthState()
	const toasts = useToasts()
	const emailOtpChallengeForm = new EmailOtpChallengeFormDraft()
	const emailOtpVerificationForm = new EmailOtpVerificationFormDraft()
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
		reset: resetRequestEmailOtp,
	} = useApiAction(async () => {
		const input = emailOtpChallengeForm.toModel()
		const response = await authState.requestEmailOtp(input.email)
		emailOtpVerificationForm.loadEntity({ email: input.email, code: '' })
		challengeRequested.value = true
		toasts.success({ title: 'Sign-in code sent.', body: 'Check your email for the six-digit code.' })
		return response
	})

	const {
		isLoading: isVerifyingEmailOtp,
		error: verifyEmailOtpError,
		execute: verifyEmailOtp,
		reset: resetVerifyEmailOtp,
	} = useApiAction(async () => {
		const input = emailOtpVerificationForm.toModel()
		const response = await authState.verifyEmailOtpSignIn(input.email, input.code)
		emailOtpVerificationForm.code = ''
		challengeRequested.value = false
		await options.onSuccess?.()
		return response
	})

	function changeEmail(): void {
		challengeRequested.value = false
		emailOtpVerificationForm.loadEntity({ email: emailOtpChallengeForm.email, code: '' })
	}

	return {
		emailOtpChallengeForm,
		emailOtpVerificationForm,
		challengeRequested,
		isRequestingEmailOtp,
		requestEmailOtpError,
		requestEmailOtp,
		resetRequestEmailOtp,
		isVerifyingEmailOtp,
		verifyEmailOtpError,
		verifyEmailOtp,
		resetVerifyEmailOtp,
		changeEmail,
	}
}
