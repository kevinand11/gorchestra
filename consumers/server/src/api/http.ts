import { v, type Pipe, type PipeOutput } from 'valleyed'

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

export function moduleCookiesToResponseCookies(...cookies: ServerModuleCookie[]): ServerApiResponseCookies {
	return Object.fromEntries(cookies.map((cookie) => [cookie.name, moduleCookieToResponseCookie(cookie)]))
}

export function optionalCookiePipe<const Name extends string>(
	name: Name,
): Pipe<Record<string, string | undefined>, Record<Name, string | undefined>> {
	return v.object({ [name]: v.optional(v.string()) }) as Pipe<Record<string, string | undefined>, Record<Name, string | undefined>>
}

export function jsonObjectPipe<const Shape extends Record<string, Pipe<unknown, unknown>>>(shape: Shape) {
	return v.fromJson(v.object(shape))
}

export type JsonObjectPipeOutput<Shape extends Record<string, Pipe<unknown, unknown>>> = PipeOutput<
	ReturnType<typeof jsonObjectPipe<Shape>>
>

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
