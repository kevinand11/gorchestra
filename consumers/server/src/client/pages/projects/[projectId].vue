<template>
	<SelectedPortfolioShell>
		<UiCard>
			<UiHeading as="h1" size="section">Returning to Projects…</UiHeading>
			<UiText tone="muted">Project detail views are not part of this slice yet.</UiText>
		</UiCard>
	</SelectedPortfolioShell>
</template>

<script setup lang="ts">
import SelectedPortfolioShell from '../../components/SelectedPortfolioShell.vue'
import UiCard from '../../components/ui/UiCard.vue'
import UiHeading from '../../components/ui/UiHeading.vue'
import UiText from '../../components/ui/UiText.vue'

definePageMeta({
	middleware: [
		'has-selection',
		() => {
			return navigateTo('/projects')
		},
	],
})
</script>
