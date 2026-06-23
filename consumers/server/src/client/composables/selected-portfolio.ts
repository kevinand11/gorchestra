import { computed } from '@vue/reactivity'

import { isSelectedPortfolio, useSelectionAccess } from './auth-state'

export function useSelectedPortfolio() {
	const { data: selectionAccess } = useSelectionAccess()
	const selected = computed(() => {
		const selection = selectionAccess.value
		if (!isSelectedPortfolio(selection)) throw new Error('Selected Portfolio context requires a valid selected Workspace and Portfolio')
		return selection
	})
	const workspace = computed(() => selected.value.workspace)
	const portfolio = computed(() => selected.value.portfolio)
	return { workspace, portfolio }
}
