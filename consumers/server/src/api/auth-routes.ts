import { Router, type RouteDef } from 'equipped/server'
import { v } from 'valleyed'

import type { ServerApiContext } from './context'
import { throwBadRequest, throwSessionAuthenticationError } from './errors'
import { moduleCookiesToResponseCookies, jsonObjectPipe } from './http'
import {
	authenticateApiSession,
	getSessionToken,
	refreshApiSession,
	revokeApiSessionIfAuthenticated,
	sessionCookieSchema,
	signedOutResponseCookies,
} from './session'
import { createEmailOtpChallenge } from '../modules/email-otp'
import { verifyEmailOtpSignIn } from '../modules/email-otp-sign-in'

const emailOtpChallengeBodySchema = jsonObjectPipe({ email: nonEmptyStringPipe() })
const emailOtpSignInBodySchema = jsonObjectPipe({ email: nonEmptyStringPipe(), code: nonEmptyStringPipe() })

export function createAuthApiRouter(context: ServerApiContext): Router<RouteDef> {
	const router = new Router({ path: '/api' })

	router.post('auth/email-otp/challenges', { schema: { body: emailOtpChallengeBodySchema } })(async (req) => {
		const result = await createEmailOtpChallenge({ email: req.body.email, now: context.now() })
		return req.res({ body: result })
	})

	router.post('auth/email-otp/sign-in', { schema: { body: emailOtpSignInBodySchema } })(async (req) => {
		const result = await verifyEmailOtpSignIn({
			serverStorage: context.serverStorage,
			email: req.body.email,
			code: req.body.code,
			now: context.now(),
			signingKey: context.sessionSigningKey,
		})
		if (!result.signedIn) throwBadRequest(`Email OTP Sign-in failed: ${result.reason}`)
		return req.res({ body: result, cookies: moduleCookiesToResponseCookies(result.cookie) })
	})

	router.get('session', { schema: { cookies: sessionCookieSchema } })(async (req) => {
		const result = await authenticateApiSession(context, getSessionToken(req.cookies))
		return req.res({ body: result })
	})

	router.post('session/refresh', { schema: { cookies: sessionCookieSchema } })(async (req) => {
		const result = await refreshApiSession(context, getSessionToken(req.cookies))
		if (!result.refreshed) return throwRefreshSessionError(result.reason)
		return req.res({ body: result, cookies: moduleCookiesToResponseCookies(result.cookie) })
	})

	router.post('session/logout', { schema: { cookies: sessionCookieSchema } })(async (req) => {
		await revokeApiSessionIfAuthenticated(context, getSessionToken(req.cookies))
		return req.res({ body: { signedOut: true }, cookies: signedOutResponseCookies() })
	})

	return router
}

function nonEmptyStringPipe() {
	return v.string().pipe(v.asTrimmed(), v.min<string>(1))
}

function throwRefreshSessionError(reason: Extract<Awaited<ReturnType<typeof refreshApiSession>>, { refreshed: false }>['reason']): never {
	if (reason === 'previous-token-grace') throwBadRequest('Previous Session token cannot be refreshed')
	throwSessionAuthenticationError('not-current')
}
