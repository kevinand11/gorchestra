import { useQueryCache } from '../composables/core/query-cache'
import { setAuthenticationLostHandler, setPreconditionRequiredHandler, setServerApiOptionsResolver } from '../composables/core/server-api'

export default defineNuxtPlugin((nuxtApp) => {
	setAuthenticationLostHandler(() => {
		void nuxtApp.runWithContext(() => {
			useQueryCache().clear([])
			return navigateTo('/sign-in')
		})
	})
	setPreconditionRequiredHandler(() => {
		void nuxtApp.runWithContext(() => {
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
