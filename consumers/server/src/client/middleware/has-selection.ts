import { useSessionLoaders } from '../composables/auth/session'

export default defineNuxtRouteMiddleware(async () => {
	const { loadSession, loadSelection } = useSessionLoaders()
	const session = await loadSession()
	if (!session.authenticated) return navigateTo('/sign-in')

	const selection = await loadSelection()
	if (!selection.selected) return navigateTo('/select')
})
