import { defineNuxtRouteMiddleware, navigateTo } from 'nuxt/app'

import { useSessionStore } from '../stores/session'

export default defineNuxtRouteMiddleware(async () => {
	if (typeof window === 'undefined') return

	const sessionStore = useSessionStore()
	await sessionStore.loadAuthenticatedState()
	if (!sessionStore.isAuthenticated) return navigateTo('/sign-in')
	if (!sessionStore.hasSelection) return navigateTo('/select')
})
