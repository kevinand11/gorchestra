import { defineNuxtRouteMiddleware, navigateTo } from 'nuxt/app'

import { loadAuthFlowState, redirectForAuthFlowRoute } from '../composables/useAuthFlow'

export default defineNuxtRouteMiddleware(async (to) => {
	try {
		const redirect = redirectForAuthFlowRoute(to.path, await loadAuthFlowState())
		return redirect === null ? undefined : navigateTo(redirect)
	} catch {
		return to.path === '/sign-in' ? undefined : navigateTo('/sign-in')
	}
})
