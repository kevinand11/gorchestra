import { ref, watch } from 'vue'

import { useSetAuth } from './session'
import { EmailOtpChallengeFormDraft, EmailOtpVerificationFormDraft } from '../../forms/auth'
import { useApiAction } from '../core/action-state'
import { useOverlay } from '../core/overlay'
import { useServerApi } from '../core/server-api'

type EmailOtpSignInOptions = {
	onSuccess?: () => void | Promise<void>
}

export function useEmailOtpSignIn(options: EmailOtpSignInOptions = {}) {
	const serverApi = useServerApi()
	const { setSession } = useSetAuth()
	const { toast } = useOverlay()
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
		await serverApi.requestEmailOtp(input.email)
		emailOtpVerificationForm.loadEntity({ email: input.email, code: '' })
		challengeRequested.value = true
		toast.success({ title: 'Sign-in code sent.', body: 'Check your email for the six-digit code.' })
	})

	const {
		isLoading: isVerifyingEmailOtp,
		error: verifyEmailOtpError,
		execute: verifyEmailOtp,
		reset: resetVerifyEmailOtp,
	} = useApiAction(async () => {
		const input = emailOtpVerificationForm.toModel()
		const response = await serverApi.verifyEmailOtpSignIn(input.email, input.code)
		setSession({ authenticated: true, session: response.session, refreshRecommended: false })
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
