<template>
	<PortfolioLayout topbar-search-label="Search Projects, Memories, Repositories, Secrets, Deliveries…">
		<template #main-header>
			<header class="border-b border-dimmer px-3 pt-3">
				<div class="min-w-0">
					<h1 class="m-0 truncate text-sz-section font-semibold tracking-[-0.01em]">{{ title }}</h1>
					<p v-if="subtitle" class="m-0 mt-1 text-sz-helper text-dim">{{ subtitle }}</p>
				</div>
				<nav class="mt-3 flex gap-4" aria-label="Brain navigation">
					<NuxtLink
						v-for="{ label, to } in brainTabs"
						:key="to"
						:to="to"
						class="border-b-2 px-0 pb-2 text-sz-helper font-semibold no-underline"
						:class="isActiveBrainTab(to) ? 'border-primary text-body' : 'border-transparent text-dim hover:text-body'">
						{{ label }}
					</NuxtLink>
				</nav>
			</header>
		</template>

		<slot />

		<template v-if="$slots.right" #right>
			<slot name="right" />
		</template>
	</PortfolioLayout>
</template>

<script setup lang="ts">
import PortfolioLayout from './portfolio.vue'

defineProps<{
	title: string
	subtitle?: string
}>()

const route = useRoute()
const brainTabs = [
	{ label: 'Graph', to: '/brain' },
	{ label: 'Memories', to: '/brain/memories' },
]

function isActiveBrainTab(to: string): boolean {
	return to === '/brain' ? route.path === to : route.path === to || route.path.startsWith(`${to}/`)
}
</script>
