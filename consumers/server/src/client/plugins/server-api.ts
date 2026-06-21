import { defineNuxtPlugin, navigateTo, tryUseNuxtApp, useRequestHeaders, useRequestURL } from 'nuxt/app'

import { setPreconditionRequiredHandler, setServerApiOptionsResolver } from '../composables/useServerApi'

export default defineNuxtPlugin((nuxtApp) => {
	setPreconditionRequiredHandler(() => {
		void nuxtApp.runWithContext(() => navigateTo('/select'))
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
