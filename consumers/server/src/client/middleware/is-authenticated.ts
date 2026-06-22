import { defineNuxtRouteMiddleware, navigateTo } from 'nuxt/app'

import { useSessionStore } from '../stores/session'

export default defineNuxtRouteMiddleware(async () => {
	const sessionStore = useSessionStore()
	await sessionStore.loadAuthenticatedState()
	if (!sessionStore.isAuthenticated) return navigateTo('/sign-in')
})
