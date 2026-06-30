<template>
	<NuxtLayout name="brain" title="Memories" subtitle="Browse root Portfolio Memories.">
		<section>
			<div class="flex min-h-10 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
				<span class="text-sz-helper text-dim">{{ memories.length }} {{ memories.length === 1 ? 'Memory' : 'Memories' }}</span>
				<span v-if="isRefreshingMemories" class="text-sz-helper text-dim">Refreshing Memories…</span>
			</div>

			<div v-if="isLoadingMemories && !hasLoadedMemories" class="border-b border-dimmer px-3 py-4 text-dim">Loading Memories…</div>
			<div v-else-if="memoriesError" class="border-b border-dimmer px-3 py-4 text-error">{{ memoriesError }}</div>
			<div v-else-if="memories.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Memories yet.</h2>
				<p class="m-0 mt-1 max-w-[680px] text-sz-helper leading-5 text-dim">
					Memories are database-backed notes in the selected Portfolio Brain. Creation UI is being reworked in the next slice.
				</p>
			</div>
			<div v-else>
				<NuxtLink
					v-for="memory in memories"
					:key="memory.id"
					:to="`/brain/memories/${memory.id}`"
					class="grid w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-0 border-b border-dimmer bg-transparent px-3 py-2 text-left text-body hover:bg-card focus-visible:bg-secondary">
					<span class="grid size-5 place-items-center border border-dimmer text-sz-micro font-semibold text-dim">M</span>
					<span class="min-w-0">
						<strong class="block truncate font-semibold">{{ memory.currentRevision.title }}</strong>
						<span v-if="memory.currentRevision.body" class="memory-preview mt-0.5 text-sz-helper text-dim">{{
							memory.currentRevision.body
						}}</span>
					</span>
				</NuxtLink>
			</div>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { usePortfolioMemoryChildrenQuery } from '../../../composables/portfolio-resource-queries.js'
import { useServerApi } from '../../../composables/useServerApi.js'

definePageMeta({ middleware: ['has-selection'] })

const serverApi = useServerApi()
const parentId = computed(() => null as string | null)
const {
	data: memories,
	isLoading: isLoadingMemories,
	error: memoriesError,
	hasExecuted: hasLoadedMemories,
} = usePortfolioMemoryChildrenQuery(serverApi, parentId)

const isRefreshingMemories = computed(() => isLoadingMemories.value && hasLoadedMemories.value)
</script>

<style scoped>
.memory-preview {
	display: -webkit-box;
	overflow: hidden;
	-webkit-box-orient: vertical;
	line-clamp: 2;
	-webkit-line-clamp: 2;
}
</style>
