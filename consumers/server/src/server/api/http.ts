import { v, type Pipe } from 'valleyed'

export type ServerApiResponseCookie = {
	value: string
	path?: string
	httpOnly?: boolean
	secure?: boolean
	sameSite?: 'lax'
	maxAge?: number
	expires?: Date
}

export type ServerModuleCookie = Omit<ServerApiResponseCookie, 'value'> & {
	name: string
	value: string
}

export type ServerApiResponseCookies = Record<string, ServerApiResponseCookie>
export type ResponseCookiesFromModuleCookies<Cookies extends readonly ServerModuleCookie[]> = {
	[Cookie in Cookies[number] as Cookie['name']]: ServerApiResponseCookie
}

export function moduleCookiesToResponseCookies<const Cookies extends readonly ServerModuleCookie[]>(
	...cookies: Cookies
): ResponseCookiesFromModuleCookies<Cookies> {
	return Object.fromEntries(
		cookies.map((cookie) => [cookie.name, moduleCookieToResponseCookie(cookie)]),
	) as ResponseCookiesFromModuleCookies<Cookies>
}

export function optionalCookiePipe<const Name extends string>(
	name: Name,
): Pipe<Record<string, string | undefined>, Record<Name, string | undefined>> {
	return v.object({ [name]: v.optional(v.string()) }) as Pipe<Record<string, string | undefined>, Record<Name, string | undefined>>
}

function moduleCookieToResponseCookie(cookie: ServerModuleCookie): ServerApiResponseCookie {
	const { name: _name, ...responseCookie } = cookie
	return responseCookie
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server API HTTP helpers', () => {
		it('maps module cookie metadata to Equipped response cookies keyed by cookie name', () => {
			expect(
				moduleCookiesToResponseCookies({
					name: 'gorchestra_session',
					value: 'token',
					path: '/',
					httpOnly: true,
					secure: true,
					sameSite: 'lax',
					maxAge: 60,
				}),
			).toEqual({
				gorchestra_session: {
					value: 'token',
					path: '/',
					httpOnly: true,
					secure: true,
					sameSite: 'lax',
					maxAge: 60,
				},
			})
		})
	})
}
