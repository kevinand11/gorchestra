<template>
	<UiShell>
		<SelectedPortfolioNav />
		<slot />
	</UiShell>
</template>

<script setup lang="ts">
import SelectedPortfolioNav from './SelectedPortfolioNav.vue'
import UiShell from './ui/UiShell.vue'
</script>
