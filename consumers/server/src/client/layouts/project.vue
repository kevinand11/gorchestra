<template>
	<PortfolioLayout topbar-search-label="Search this Project…">
		<template #main-header>
			<header class="border-b border-dimmer px-3 pt-3">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0">
						<h1 class="m-0 truncate text-sz-section font-semibold tracking-[-0.01em]">{{ projectTitle }}</h1>
						<p v-if="projectSubtitle" class="m-0 mt-1 text-sz-helper text-dim">{{ projectSubtitle }}</p>
					</div>
				</div>
				<nav class="mt-3 flex gap-4" aria-label="Project navigation">
					<NuxtLink
						v-for="{ label, to } in [
							{ label: 'Repositories', to: `/projects/${projectId}/repositories` },
							{ label: 'Deliveries', to: `/projects/${projectId}/deliveries` },
						]"
						:key="to"
						:to="to"
						class="border-b-2 px-0 pb-2 text-sz-helper font-semibold no-underline"
						:class="route.fullPath.startsWith(to) ? 'border-primary text-body' : 'border-transparent text-dim hover:text-body'">
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
	projectId: string
	projectTitle: string
	projectSubtitle: string
}>()

const route = useRoute()
</script>
