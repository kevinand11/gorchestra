<template>
	<PortfolioLayout topbar-search-label="Search this Project…">
		<template #main-header>
			<header class="border-b border-dimmer px-3 pt-3">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0">
						<h1 class="m-0 truncate text-sz-section font-semibold tracking-[-0.01em]">{{ props.projectTitle }}</h1>
						<p v-if="props.projectSubtitle" class="m-0 mt-1 text-sz-helper text-dim">{{ props.projectSubtitle }}</p>
					</div>
				</div>
				<nav class="mt-3 flex gap-4" aria-label="Project navigation">
					<NuxtLink
						:to="projectRootPath"
						class="border-b-2 px-0 pb-2 text-sz-helper font-semibold no-underline"
						:class="
							props.activeTab === 'repositories' ? 'border-primary text-body' : 'border-transparent text-dim hover:text-body'
						">
						Repositories
					</NuxtLink>
					<span
						class="border-b-2 px-0 pb-2 text-sz-helper font-semibold"
						:class="props.activeTab === 'deliveries' ? 'border-primary text-body' : 'border-transparent text-dim'">
						Deliveries
					</span>
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

const props = withDefaults(
	defineProps<{
		projectId?: string
		projectTitle: string
		projectSubtitle?: string
		activeTab?: 'repositories' | 'deliveries'
	}>(),
	{ projectId: '', projectSubtitle: '', activeTab: 'repositories' },
)

const projectRootPath = computed(() => (props.projectId.length === 0 ? '/projects' : `/projects/${props.projectId}`))
</script>
