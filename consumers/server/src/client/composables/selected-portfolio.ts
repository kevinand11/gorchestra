import { computed } from '@vue/reactivity'

import { useSessionStore } from '../stores/session'

export function useSelectedPortfolio() {
	const sessionStore = useSessionStore()
	const selected = computed(() => {
		const selection = sessionStore.selection
		if (selection?.selected !== true) throw new Error('Selected Portfolio context requires a valid selected Workspace and Portfolio')
		return selection
	})
	const workspace = computed(() => selected.value.workspace)
	const portfolio = computed(() => selected.value.portfolio)
	return { workspace, portfolio }
}
