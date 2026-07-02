import { useSession } from '../composables/auth/session'

type SessionState = ReturnType<typeof useSession>
type Session = SessionState['session']['value']
type Selection = SessionState['selection']['value']
type AccessRedirect = '/sign-in' | '/select'

export default defineNuxtRouteMiddleware(async () => {
	const { session, selection } = useSession()
	const redirect = sessionRedirect(session.value) ?? selectionRedirect(selection.value)
	return redirect === null ? undefined : navigateTo(redirect)
})

function sessionRedirect(session: Session): AccessRedirect | null {
	return session?.authenticated === true ? null : '/sign-in'
}

function selectionRedirect(selection: Selection): AccessRedirect | null {
	return selection?.selected === true ? null : '/select'
}
