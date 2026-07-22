import { useSessionLoaders } from '../composables/auth/session'
import { serverSocketUnavailableMessage, useServerSocketConnection } from '../composables/core/server-socket'
import { resolveSelectedRouteAccess } from '../utils/selected-server-socket'

export default defineNuxtRouteMiddleware(async () => {
	const { loadSession, loadSelection } = useSessionLoaders()
	try {
		const access = await resolveSelectedRouteAccess({
			browser: typeof window !== 'undefined',
			loadSession,
			loadSelection,
			connect: async (identity) => await useServerSocketConnection().connect(identity),
		})
		if (!access.ready) return navigateTo(access.redirect)
	} catch (error) {
		if (error instanceof Error && error.message === serverSocketUnavailableMessage)
			throw createError({ statusCode: 503, statusMessage: serverSocketUnavailableMessage })
		throw error
	}
})
