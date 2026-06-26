<template>
	<NuxtLayout name="brain" title="Memory Detail" subtitle="Inspect one Portfolio Memory and the Links that place it in the Brain.">
		<section>
			<div v-if="isLoadingMemory && !hasLoadedMemory" class="border-b border-dimmer px-3 py-4 text-dim">Loading Memory…</div>
			<p v-if="isLoadingMemory && hasLoadedMemory" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Memory…
			</p>
			<div v-else-if="memoryError" class="border-b border-dimmer px-3 py-4 text-error">{{ memoryError }}</div>
			<article v-else-if="memory">
				<header class="border-b border-dimmer px-3 py-3">
					<p class="m-0 text-sz-tiny font-bold uppercase tracking-[0.08em] text-primary">
						{{ memoryStatusLabel(memory.status) }} Memory · {{ memoryTypeLabel(memory.type) }}
					</p>
					<h2 class="m-0 mt-2 max-w-[760px] text-[32px] leading-[1.08] font-semibold tracking-[-0.03em]">
						{{ memory.title }}
					</h2>
				</header>

				<div class="border-b border-dimmer px-3 py-2">
					<div class="flex flex-wrap gap-1.5">
						<span class="border border-dimmer bg-secondary px-1.5 py-0.5 text-sz-micro font-semibold text-dim">{{
							memoryTypeLabel(memory.type)
						}}</span>
						<span :class="memoryStatusClass(memory.status)">{{ memoryStatusLabel(memory.status) }}</span>
						<span class="border border-dimmer bg-secondary px-1.5 py-0.5 text-sz-micro font-semibold text-dim"
							>Created {{ formatDate(memory.created.at) }}</span
						>
						<span class="border border-dimmer bg-secondary px-1.5 py-0.5 text-sz-micro font-semibold text-dim">{{
							linkCountLabel(memory.links.length)
						}}</span>
					</div>
				</div>

				<section class="max-w-[860px] px-3 py-3">
					<p v-if="memory.body" class="m-0 text-sz-body leading-7 text-body">{{ memory.body }}</p>
					<p v-else class="m-0 text-sz-helper leading-5 text-dim">This Memory has no body.</p>
				</section>
			</article>
		</section>

		<template v-if="memory" #right>
			<div v-if="memory.status === 'current'">
				<div class="border-b border-dimmer px-3 py-2 font-semibold">Actions</div>
				<div class="border-b border-dimmer px-3 py-3">
					<NuxtLink
						:to="{ path: '/brain/memories/new', query: { supersedes: memory.id } }"
						class="inline-flex border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast no-underline hover:brightness-110">
						Supersede Memory
					</NuxtLink>
					<p class="m-0 mt-2 text-sz-helper leading-5 text-dim">Create a newer Memory that supersedes this one.</p>
				</div>
			</div>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Links</div>
			<div class="border-b border-dimmer px-3 py-3 text-sz-helper leading-5 text-dim">
				Active Links appear first. Linked node references are shown as plain text in this slice.
			</div>
			<div v-if="orderedLinks.length === 0" class="border-b border-dimmer px-3 py-3 text-sz-helper text-dim">No Links.</div>
			<div v-else>
				<div
					v-for="link in orderedLinks"
					:key="link.id"
					class="border-b border-dimmer px-3 py-3"
					:class="isArchivedLink(link) ? 'opacity-75' : ''">
					<span class="block text-sz-helper font-semibold text-primary">{{ link.type }}</span>
					<span class="mt-1 block text-sz-helper leading-5">{{ linkSentence(link, memory) }}</span>
					<span class="mt-1 block text-sz-micro text-dim">{{ isArchivedLink(link) ? 'Archived Link' : 'Current Link' }}</span>
				</div>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { usePortfolioMemoryQuery } from '../../../composables/portfolio-resource-queries'
import { useServerApi, type ServerApi } from '../../../composables/useServerApi'
import { formatDate } from '../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type MemoryDetails = Awaited<ReturnType<ServerApi['getMemory']>>
type MemoryLink = MemoryDetails['links'][number]

const route = useRoute()
const serverApi = useServerApi()
const memoryId = computed(() => route.params.memoryId as string)
const {
	data: memory,
	isLoading: isLoadingMemory,
	error: memoryError,
	hasExecuted: hasLoadedMemory,
} = usePortfolioMemoryQuery(serverApi, memoryId)

const orderedLinks = computed(() =>
	[...(memory.value?.links ?? [])].sort((left, right) => Number(isArchivedLink(left)) - Number(isArchivedLink(right))),
)

function memoryTypeLabel(type: MemoryDetails['type']): string {
	return type === null ? 'Uncategorized' : titleCase(type)
}

function memoryStatusLabel(status: MemoryDetails['status']): string {
	return titleCase(status)
}

function memoryStatusClass(status: MemoryDetails['status']): string {
	const base = 'inline-flex border px-1.5 py-0.5 text-sz-micro font-semibold'
	return status === 'current' ? `${base} border-success/50 bg-success/10 text-success` : `${base} border-dimmer bg-secondary text-dim`
}

function linkCountLabel(count: number): string {
	return `${count} ${count === 1 ? 'Link' : 'Links'}`
}

function linkSentence(link: MemoryLink, currentMemory: MemoryDetails): string {
	const incoming = link.to.type === 'memory' && link.to.id === currentMemory.id
	return incoming ? `${nodeRefLabel(link.from)} ${link.type} this Memory` : `This Memory ${link.type} ${nodeRefLabel(link.to)}`
}

function nodeRefLabel(ref: MemoryLink['from']): string {
	return `${titleCase(ref.type)} ${ref.id}`
}

function isArchivedLink(link: MemoryLink): boolean {
	return link.archivePeriods.some((period) => period.unarchived === null)
}

function titleCase(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
</script>
