import { defineNuxtRouteMiddleware, navigateTo } from 'nuxt/app'

import { isAuthenticatedSession, useAuthState } from '../composables/auth-state'

export default defineNuxtRouteMiddleware(async () => {
	const session = await useAuthState().getSession()
	if (!isAuthenticatedSession(session)) return navigateTo('/sign-in')
})
