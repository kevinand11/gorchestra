import { isAuthenticatedSession, isSelectedPortfolio, useAuthState } from '../composables/auth-state'

export default defineNuxtRouteMiddleware(async () => {
	const authState = useAuthState()
	const session = await authState.getSession()
	if (!isAuthenticatedSession(session)) return navigateTo('/sign-in')

	const selection = await authState.getSelection()
	if (!isSelectedPortfolio(selection)) return navigateTo('/select')
})
