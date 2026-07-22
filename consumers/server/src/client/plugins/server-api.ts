import { useQueryCache } from '../composables/core/query-cache'
import { setAuthenticationLostHandler, setPreconditionRequiredHandler, setServerApiOptionsResolver } from '../composables/core/server-api'
import { useServerSocketConnection } from '../composables/core/server-socket'

export default defineNuxtPlugin((nuxtApp) => {
	setAuthenticationLostHandler(() => {
		void nuxtApp.runWithContext(() => {
			useServerSocketConnection().disconnect()
			useQueryCache().clear([])
			return navigateTo('/sign-in')
		})
	})
	setPreconditionRequiredHandler(() => {
		void nuxtApp.runWithContext(() => {
			useServerSocketConnection().disconnect()
			useQueryCache().clear(['portfolio'])
			return navigateTo('/select')
		})
	})
	setServerApiOptionsResolver(() => {
		if (typeof window !== 'undefined' || tryUseNuxtApp() === null) return null

		const url = useRequestURL()
		const headers = useRequestHeaders(['cookie'])
		return {
			baseURL: `${url.protocol}//${url.host}/api`,
			...(typeof headers.cookie === 'string' ? { headers: { cookie: headers.cookie } } : {}),
		}
	})
})
