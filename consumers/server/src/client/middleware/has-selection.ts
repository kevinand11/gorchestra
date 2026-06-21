import { defineNuxtRouteMiddleware, navigateTo } from 'nuxt/app'

import { useRequestServerApi } from '../composables/useRequestServerApi'
import { useSessionStore } from '../stores/session'

export default defineNuxtRouteMiddleware(async () => {
	const sessionStore = useSessionStore()
	await sessionStore.loadAuthenticatedState(useRequestServerApi())
	if (!sessionStore.isAuthenticated) return navigateTo('/sign-in')
	if (!sessionStore.hasSelection) return navigateTo('/select')
})
