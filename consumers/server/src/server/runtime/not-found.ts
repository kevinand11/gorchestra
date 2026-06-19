import { EquippedError, NotFoundError } from 'equipped/errors'
import type { RawResponseHandler, RawResponseHandled, ServerNotFoundHandler } from 'equipped/server'

export function createServerConsumerNotFoundHandler(nuxtListener: RawResponseHandler): ServerNotFoundHandler {
	return createDeferredServerConsumerNotFoundHandler(() => nuxtListener)
}

export function createDeferredServerConsumerNotFoundHandler(getNuxtListener: () => RawResponseHandler | null): ServerNotFoundHandler {
	return ({ request, respondWithRaw }) => {
		if (isEquippedApiPath(request.path)) throw new NotFoundError(`Route ${request.path} not found`)
		const nuxtListener = getNuxtListener()
		if (!nuxtListener) throw new EquippedError('Nuxt listener is not ready', {})
		return respondWithRaw(nuxtListener)
	}
}

function isEquippedApiPath(path: string): boolean {
	const pathname = path.split('?')[0] ?? path
	return pathname === '/api' || pathname.startsWith('/api/')
}

if (import.meta.vitest) {
	const { describe, expect, it, vi } = import.meta.vitest

	const rawHandled = {} as RawResponseHandled
	const nuxtListener: RawResponseHandler = () => undefined

	describe('Server Consumer not-found handler', () => {
		it.each(['/api', '/api/', '/api/health', '/api/unknown', '/api?openapi=json'])('treats %s as Equipped API-owned', (path) => {
			const handler = createServerConsumerNotFoundHandler(nuxtListener)

			expect(() =>
				handler({
					request: { path } as Parameters<ServerNotFoundHandler>[0]['request'],
					respondWithRaw: vi.fn(() => Promise.resolve(rawHandled)),
				}),
			).toThrow(NotFoundError)
		})

		it.each(['/', '/workspaces', '/_nuxt/app.js', '/apiary', '/api-v2/missing'])('delegates %s to the Nuxt listener', async (path) => {
			const respondWithRaw = vi.fn(() => Promise.resolve(rawHandled))
			const handler = createServerConsumerNotFoundHandler(nuxtListener)

			await expect(handler({ request: { path } as Parameters<ServerNotFoundHandler>[0]['request'], respondWithRaw })).resolves.toBe(
				rawHandled,
			)
			expect(respondWithRaw).toHaveBeenCalledWith(nuxtListener)
		})

		it('rejects non-api fallback before the deferred Nuxt listener is ready', () => {
			const handler = createDeferredServerConsumerNotFoundHandler(() => null)

			expect(() =>
				handler({
					request: { path: '/' } as Parameters<ServerNotFoundHandler>[0]['request'],
					respondWithRaw: vi.fn(() => Promise.resolve(rawHandled)),
				}),
			).toThrow('Nuxt listener is not ready')
		})
	})
}
