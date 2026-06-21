import { Router, StatusCodes, type RouteDef } from 'equipped/server'
import { v } from 'valleyed'

import { createEmailOtpChallenge } from '../../modules/email-otp'
import { verifyEmailOtpSignIn } from '../../modules/email-otp-sign-in'
import type { ServerApiContext } from '../context'
import { throwBadRequest, throwSessionAuthenticationError } from '../errors'
import { jsonObjectPipe, moduleCookiesToResponseCookies } from '../http'
import {
	emailOtpChallengeResponseSchema,
	emailOtpSignInResponseSchema,
	refreshedSessionResponseSchema,
	sessionAuthenticationResponseSchema,
	sessionResponseCookieSchema,
	signedOutResponseCookieSchema,
	signedOutResponseSchema,
} from '../schemas'
import {
	authenticateApiSession,
	getSessionToken,
	refreshApiSession,
	revokeApiSessionIfAuthenticated,
	sessionCookieSchema,
	signedOutResponseCookies,
} from '../session'

const emailOtpChallengeBodySchema = jsonObjectPipe({ email: nonEmptyStringPipe() })
const emailOtpSignInBodySchema = jsonObjectPipe({ email: nonEmptyStringPipe(), code: nonEmptyStringPipe() })

export function createAuthApiRouter(context: ServerApiContext): Router<RouteDef> {
	const router = new Router({ path: '/auth' })

	router.post('/email-otp/challenges', {
		schema: { body: emailOtpChallengeBodySchema, response: emailOtpChallengeResponseSchema, defaultStatusCode: StatusCodes.NoContent },
	})(async (req) => {
		await createEmailOtpChallenge({ email: req.body.email, now: context.now() })
		return req.res({ status: StatusCodes.NoContent, body: undefined })
	})

	router.post('/email-otp/sign-in', {
		schema: { body: emailOtpSignInBodySchema, response: emailOtpSignInResponseSchema, responseCookies: sessionResponseCookieSchema },
	})(async (req) => {
		const result = await verifyEmailOtpSignIn({
			serverStorage: context.serverStorage,
			email: req.body.email,
			code: req.body.code,
			now: context.now(),
			signingKey: context.sessionSigningKey,
		})
		if (!result.signedIn) throwBadRequest(`Email OTP Sign-in failed: ${result.reason}`)
		return req.res({
			body: {
				user: result.user,
				emailAuthenticationIdentity: result.emailAuthenticationIdentity,
				createdUser: result.createdUser,
				session: result.session,
			},
			cookies: moduleCookiesToResponseCookies(result.cookie),
		})
	})

	router.get('/session', { schema: { cookies: sessionCookieSchema, response: sessionAuthenticationResponseSchema } })(async (req) =>
		authenticateApiSession(context, getSessionToken(req.cookies)),
	)

	router.post('/refresh', {
		schema: { cookies: sessionCookieSchema, response: refreshedSessionResponseSchema, responseCookies: sessionResponseCookieSchema },
	})(async (req) => {
		const result = await refreshApiSession(context, getSessionToken(req.cookies))
		if (!result.refreshed) return throwRefreshSessionError(result.reason)
		return req.res({ body: result.session, cookies: moduleCookiesToResponseCookies(result.cookie) })
	})

	router.delete('/session', {
		schema: {
			cookies: sessionCookieSchema,
			response: signedOutResponseSchema,
			responseCookies: signedOutResponseCookieSchema,
			defaultStatusCode: StatusCodes.NoContent,
		},
	})(async (req) => {
		await revokeApiSessionIfAuthenticated(context, getSessionToken(req.cookies))
		return req.res({ status: StatusCodes.NoContent, body: undefined, cookies: signedOutResponseCookies() })
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
