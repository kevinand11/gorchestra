import { defineNuxtRouteMiddleware, navigateTo } from 'nuxt/app'

import { useSessionStore } from '../stores/session'

export default defineNuxtRouteMiddleware(async () => {
	if (typeof window === 'undefined') return

	const sessionStore = useSessionStore()
	await sessionStore.loadSession()
	if (!sessionStore.isAuthenticated) return navigateTo('/sign-in')
})
