import { useSession } from '../composables/auth/session'

export default defineNuxtRouteMiddleware(async () => {
	const { session } = useSession()
	if (session.value && session.value.authenticated) return navigateTo('/')
})
