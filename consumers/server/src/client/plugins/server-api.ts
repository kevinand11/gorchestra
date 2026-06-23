import { defineNuxtPlugin, navigateTo, tryUseNuxtApp, useRequestHeaders, useRequestURL } from 'nuxt/app'

import { useQueryCache } from '../composables/query-cache'
import { setAuthenticationLostHandler, setPreconditionRequiredHandler, setServerApiOptionsResolver } from '../composables/useServerApi'

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
