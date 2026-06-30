<template>
	<NuxtLayout name="brain" title="Memory Detail" subtitle="Inspect one Portfolio Memory.">
		<section>
			<div v-if="isLoadingMemory && !hasLoadedMemory" class="border-b border-dimmer px-3 py-4 text-dim">Loading Memory…</div>
			<p v-if="isLoadingMemory && hasLoadedMemory" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Memory…
			</p>
			<div v-else-if="memoryError" class="border-b border-dimmer px-3 py-4 text-error">{{ memoryError }}</div>
			<article v-else-if="memory">
				<header class="border-b border-dimmer px-3 py-3">
					<p class="m-0 text-sz-tiny font-bold uppercase tracking-[0.08em] text-primary">Memory</p>
					<h2 class="m-0 mt-2 max-w-[760px] text-[32px] leading-[1.08] font-semibold tracking-[-0.03em]">
						{{ shownRevision.title }}
					</h2>
				</header>

				<section class="max-w-[860px] border-b border-dimmer px-3 py-3">
					<p v-if="shownRevision.body" class="m-0 text-sz-body leading-7 text-body">{{ shownRevision.body }}</p>
					<p v-else class="m-0 text-sz-helper leading-5 text-dim">This Memory has no body.</p>
				</section>

				<section>
					<div class="border-b border-dimmer px-3 py-2 font-semibold">Child Memories</div>
					<div v-if="memory.children.length === 0" class="border-b border-dimmer px-3 py-4 text-sz-helper text-dim">
						No child Memories.
					</div>
					<NuxtLink
						v-for="child in memory.children"
						:key="child.id"
						:to="`/brain/memories/${child.id}`"
						class="grid w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-0 border-b border-dimmer bg-transparent px-3 py-2 text-left text-body hover:bg-card focus-visible:bg-secondary">
						<span class="grid size-5 place-items-center border border-dimmer text-sz-micro font-semibold text-dim">M</span>
						<span class="min-w-0">
							<strong class="block truncate font-semibold">{{ child.currentRevision.title }}</strong>
							<span v-if="child.currentRevision.body" class="memory-preview mt-0.5 text-sz-helper text-dim">{{
								child.currentRevision.body
							}}</span>
						</span>
					</NuxtLink>
				</section>
			</article>
		</section>

		<template v-if="memory" #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Revision history</div>
			<div v-for="revision in memory.revisions" :key="revision.id" class="border-b border-dimmer px-3 py-3">
				<NuxtLink
					:to="{ path: `/brain/memories/${memory.id}`, query: { revisionId: revision.id } }"
					class="block text-sz-helper font-semibold text-body hover:text-primary">
					{{ revision.title }}
				</NuxtLink>
				<span class="mt-1 block text-sz-micro text-dim">{{ formatDate(revision.created.at) }}</span>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { usePortfolioMemoryQuery } from '../../../composables/portfolio-resource-queries'
import { useServerApi } from '../../../composables/useServerApi'
import { formatDate } from '../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const serverApi = useServerApi()
const memoryId = computed(() => route.params.memoryId as string)
const revisionId = computed(() => (typeof route.query.revisionId === 'string' ? route.query.revisionId : null))

const {
	data: memory,
	isLoading: isLoadingMemory,
	error: memoryError,
	hasExecuted: hasLoadedMemory,
} = usePortfolioMemoryQuery(serverApi, memoryId)

const shownRevision = computed(() => {
	if (memory.value === null) return { title: '', body: '', created: { at: '' } }
	return memory.value.revisions.find((revision) => revision.id === revisionId.value) ?? memory.value.currentRevision
})
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
