import { computed } from '@vue/reactivity'

import { useSessionStore } from '../stores/session'

export function useSelectedPortfolio() {
	const sessionStore = useSessionStore()
	return computed(() => {
		const selection = sessionStore.selection
		if (selection?.selected !== true) throw new Error('Selected Portfolio context requires a valid selected Workspace and Portfolio')
		return selection
	})
}
