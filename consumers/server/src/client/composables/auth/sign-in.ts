import { ref, watch } from 'vue'

import { EmailOtpChallengeFormDraft, EmailOtpVerificationFormDraft } from '../../forms/auth'
import { useApiAction } from '../core/action-state'
import { useQueryCache } from '../core/query-cache'
import { useServerApi } from '../core/server-api'
import { useToasts } from '../core/toasts'

type EmailOtpSignInOptions = {
	onSuccess?: () => void | Promise<void>
}

export function useEmailOtpSignIn(options: EmailOtpSignInOptions = {}) {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { queryKeys } = queryCache
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
		await serverApi.requestEmailOtp(input.email)
		emailOtpVerificationForm.loadEntity({ email: input.email, code: '' })
		challengeRequested.value = true
		toasts.success({ title: 'Sign-in code sent.', body: 'Check your email for the six-digit code.' })
	})

	const {
		isLoading: isVerifyingEmailOtp,
		error: verifyEmailOtpError,
		execute: verifyEmailOtp,
		reset: resetVerifyEmailOtp,
	} = useApiAction(async () => {
		const input = emailOtpVerificationForm.toModel()
		const response = await serverApi.verifyEmailOtpSignIn(input.email, input.code)
		queryCache.clear([])
		queryCache.set(queryKeys.session(), { authenticated: true, session: response.session, refreshRecommended: false })
		queryCache.set(queryKeys.selection(), { selected: false, reason: 'missing-token' })
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
