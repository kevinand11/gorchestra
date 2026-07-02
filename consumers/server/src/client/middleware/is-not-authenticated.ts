import { useSessionLoaders } from '../composables/auth/session'

export default defineNuxtRouteMiddleware(async () => {
	const { loadSession } = useSessionLoaders()
	const session = await loadSession()
	if (session.authenticated) return navigateTo('/')
})
