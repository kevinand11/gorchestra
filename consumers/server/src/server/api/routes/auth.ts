import { Router, StatusCodes } from 'equipped/server'
import { v } from 'valleyed'

import { createEmailOtpChallenge } from '../../modules/email-otp'
import { verifyEmailOtpSignIn } from '../../modules/email-otp-sign-in'
import type { ServerApiContext } from '../context'
import { throwBadRequest, throwSessionAuthenticationError } from '../errors'
import { moduleCookiesToResponseCookies } from '../http'
import {
	emailPipe,
	idPipe,
	isoDateTimePipe,
	noContentResponseSchema,
	sessionResponseCookieSchema,
	signedOutResponseCookieSchema,
} from '../schemas'
import {
	authenticateApiSession,
	getSessionToken,
	refreshApiSession,
	revokeApiSessionIfAuthenticated,
	sessionCookieSchema,
	signedOutResponseCookies,
} from '../session'

const emailOtpChallengeBodySchema = v.object({ email: v.string().pipe(v.email()) })
const emailOtpSignInBodySchema = v.object({ email: v.string().pipe(v.email()), code: v.string().pipe(v.asTrimmed(), v.min<string>(1)) })
const serverUserResponseSchema = v.object({ id: idPipe, createdAt: isoDateTimePipe })
const emailAuthenticationIdentityResponseSchema = v.object({
	id: idPipe,
	userId: idPipe,
	email: emailPipe,
	createdAt: isoDateTimePipe,
})
const sessionResponseSchema = v.object({
	userId: idPipe,
	email: emailPipe,
	sessionId: idPipe,
	issuedAt: isoDateTimePipe,
	expiresAt: isoDateTimePipe,
})

export function createAuthApiRouter(context: ServerApiContext) {
	return new Router({ path: '/auth' })
		.post('/email-otp/challenges', {
			schema: {
				body: emailOtpChallengeBodySchema,
				response: noContentResponseSchema,
				defaultStatusCode: StatusCodes.NoContent,
			},
		})(async (req) => {
			await createEmailOtpChallenge({ serverCache: context.serverCache, email: req.body.email, now: context.now() })
			return req.res({ status: StatusCodes.NoContent, body: undefined })
		})
		.post('/email-otp/sign-in', {
			schema: {
				body: emailOtpSignInBodySchema,
				response: v.object({
					user: serverUserResponseSchema,
					emailAuthenticationIdentity: emailAuthenticationIdentityResponseSchema,
					createdUser: v.boolean(),
					session: sessionResponseSchema,
				}),
				responseCookies: sessionResponseCookieSchema,
			},
		})(async (req) => {
			const result = await verifyEmailOtpSignIn({
				serverStorage: context.serverStorage,
				serverCache: context.serverCache,
				email: req.body.email,
				code: req.body.code,
				now: context.now(),
				signingKey: context.security.sessionSigningKey,
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
		.get('/session', {
			schema: {
				cookies: sessionCookieSchema,
				response: v.discriminate((v) => v.authenticated.toString(), {
					true: v.object({
						authenticated: v.is(true),
						session: sessionResponseSchema,
						refreshRecommended: v.boolean(),
					}),
					false: v.object({
						authenticated: v.is(false),
						reason: v.in(['missing-token', 'invalid-token', 'expired', 'not-current']),
					}),
				}),
			},
		})(async (req) => authenticateApiSession(context, getSessionToken(req.cookies)))
		.post('/refresh', {
			schema: {
				cookies: sessionCookieSchema,
				response: sessionResponseSchema,
				responseCookies: sessionResponseCookieSchema,
			},
		})(async (req) => {
			const result = await refreshApiSession(context, getSessionToken(req.cookies))
			if (!result.refreshed) throwSessionAuthenticationError('not-current')
			return req.res({ body: result.session, cookies: moduleCookiesToResponseCookies(result.cookie) })
		})
		.delete('/session', {
			schema: {
				cookies: sessionCookieSchema,
				response: noContentResponseSchema,
				responseCookies: signedOutResponseCookieSchema,
				defaultStatusCode: StatusCodes.NoContent,
			},
		})(async (req) => {
		await revokeApiSessionIfAuthenticated(context, getSessionToken(req.cookies))
		return req.res({ status: StatusCodes.NoContent, body: undefined, cookies: signedOutResponseCookies() })
	})
}
