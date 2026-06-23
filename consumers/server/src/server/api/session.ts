import type { ServerApiContext } from './context'
import { moduleCookiesToResponseCookies, optionalCookiePipe } from './http'
import { buildDeleteSelectionCookie } from '../modules/selection-cookie'
import {
	buildDeleteSessionCookie,
	refreshSessionToken,
	revokeSession,
	sessionCookieName,
	verifySessionToken,
	type RefreshSessionTokenResult,
	type ServerSession,
	type VerifySessionTokenResult,
} from '../modules/sessions'

export const sessionCookieSchema = optionalCookiePipe(sessionCookieName)

export type ApiSessionAuthentication =
	| {
			authenticated: true
			session: ServerSession
			token: string
			refreshRecommended: boolean
	  }
	| { authenticated: false; reason: Extract<VerifySessionTokenResult, { authenticated: false }>['reason'] }

export async function authenticateApiSession(context: ServerApiContext, token?: string | null): Promise<ApiSessionAuthentication> {
	const result = await verifySessionToken({ token: token ?? null, now: context.now(), signingKey: context.sessionSigningKey })
	if (!result.authenticated) return result
	return {
		authenticated: true,
		token: token ?? '',
		session: result.session,
		refreshRecommended: result.refreshRecommended,
	}
}

export async function refreshApiSession(context: ServerApiContext, token?: string | null): Promise<RefreshSessionTokenResult> {
	if (!token) return { refreshed: false, reason: 'not-authenticated' }
	return refreshSessionToken({ token, now: context.now(), signingKey: context.sessionSigningKey })
}

export async function revokeApiSessionIfAuthenticated(context: ServerApiContext, token?: string | null): Promise<void> {
	const authentication = await authenticateApiSession(context, token)
	if (authentication.authenticated) await revokeSession({ userId: authentication.session.userId })
}

export function getSessionToken(cookies: Record<string, string | undefined>): string | undefined {
	return cookies[sessionCookieName]
}

export function signedOutResponseCookies() {
	return moduleCookiesToResponseCookies(buildDeleteSessionCookie(), buildDeleteSelectionCookie())
}
