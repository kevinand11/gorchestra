<template>
	<NuxtLayout
		name="brain"
		title="Memory Ledger"
		subtitle="Search and inspect the Portfolio’s Memories. Use status, type, and Link filters to narrow the ledger.">
		<section>
			<form class="memory-filter-grid grid gap-2 border-b border-dimmer bg-body-contrast/60 p-3" @submit.prevent="applyFilters">
				<label class="grid gap-1 text-sz-helper font-semibold text-dim">
					<span>Search title/body</span>
					<input
						v-model="draft.search"
						class="border border-dimmer bg-canvas px-2 py-1.5 text-body"
						placeholder="route contract" />
				</label>
				<label class="grid gap-1 text-sz-helper font-semibold text-dim">
					<span>Status</span>
					<select v-model="draft.status" class="border border-dimmer bg-canvas px-2 py-1.5 text-body">
						<option v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
					</select>
				</label>
				<label class="grid gap-1 text-sz-helper font-semibold text-dim">
					<span>Type</span>
					<select v-model="draft.memoryType" class="border border-dimmer bg-canvas px-2 py-1.5 text-body">
						<option v-for="option in memoryTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
					</select>
				</label>
				<label class="grid gap-1 text-sz-helper font-semibold text-dim">
					<span>Linked by</span>
					<select v-model="draft.linkedBy" class="border border-dimmer bg-canvas px-2 py-1.5 text-body">
						<option v-for="option in linkedByOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
					</select>
				</label>
				<label class="grid gap-1 text-sz-helper font-semibold text-dim">
					<span>Linked to</span>
					<select v-model="draft.linkedTo" class="border border-dimmer bg-canvas px-2 py-1.5 text-body">
						<option v-for="option in linkedToOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
					</select>
				</label>
				<button
					class="justify-self-start border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast hover:brightness-110"
					type="submit">
					Apply
				</button>
			</form>

			<div class="flex min-h-10 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
				<span class="text-sz-helper text-dim"
					>{{ memories.length }} {{ memories.length === 1 ? 'Memory' : 'Memories' }} · newest first</span
				>
				<span v-if="isRefreshingMemories" class="text-sz-helper text-dim">Refreshing Memories…</span>
			</div>

			<div v-if="isLoadingMemories && !hasLoadedMemories" class="border-b border-dimmer px-3 py-4 text-dim">Loading Memories…</div>
			<div v-else-if="memoriesError" class="border-b border-dimmer px-3 py-4 text-error">{{ memoriesError }}</div>
			<div v-else-if="memories.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Memories match these filters.</h2>
				<p class="m-0 mt-1 max-w-[680px] text-sz-helper leading-5 text-dim">
					Memories are created when accepted Plan Outputs preserve decisions, facts, constraints, assumptions, risks,
					architecture, workflows, or conventions. Change the filters to inspect another part of the Portfolio Brain.
				</p>
			</div>
			<div v-else>
				<button
					v-for="memory in memories"
					:key="memory.id"
					type="button"
					class="grid w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-0 border-b border-dimmer bg-transparent px-3 py-2 text-left text-body hover:bg-card focus-visible:bg-secondary lg:grid-cols-[24px_minmax(0,1fr)_minmax(140px,auto)]"
					:class="selectedMemory?.id === memory.id ? 'bg-primary/10' : ''"
					@click="selectMemory(memory.id)">
					<span class="grid size-5 place-items-center border border-dimmer text-sz-micro font-semibold text-dim">M</span>
					<span class="min-w-0">
						<strong class="block truncate font-semibold">{{ memory.title }}</strong>
						<span v-if="memory.body" class="memory-preview mt-0.5 text-sz-helper text-dim">{{ memory.body }}</span>
						<span class="mt-1 flex flex-wrap gap-1.5">
							<span class="border border-dimmer bg-secondary px-1.5 py-0.5 text-sz-micro font-semibold text-dim">{{
								memoryTypeLabel(memory.type)
							}}</span>
							<span :class="memoryStatusClass(memory.status)">{{ memoryStatusLabel(memory.status) }}</span>
							<span class="border border-dimmer bg-secondary px-1.5 py-0.5 text-sz-micro font-semibold text-dim"
								>Created {{ formatDate(memory.created.at) }}</span
							>
						</span>
					</span>
					<span class="flex flex-wrap justify-start gap-1.5 lg:justify-end">
						<span v-if="activeLinkSummaries(memory).length === 0" class="text-sz-helper text-dim">{{
							memory.links.length === 0 ? 'No Links' : 'No active Links'
						}}</span>
						<span
							v-for="summary in activeLinkSummaries(memory)"
							:key="summary.type"
							class="border border-dimmer bg-secondary px-1.5 py-0.5 text-sz-micro font-semibold text-dim">
							{{ summary.type }} {{ summary.count }}
						</span>
					</span>
				</button>
			</div>
		</section>

		<template #right>
			<div v-if="selectedMemory" class="border-b border-dimmer px-3 py-3">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<p class="m-0 text-sz-tiny font-bold uppercase tracking-[0.08em] text-primary">Selected Memory</p>
						<strong class="mt-1 block font-semibold">{{ selectedMemory.title }}</strong>
						<p class="m-0 mt-1 text-sz-helper text-dim">
							{{ memoryTypeLabel(selectedMemory.type) }} · {{ memoryStatusLabel(selectedMemory.status) }} · Created
							{{ formatDate(selectedMemory.created.at) }}
						</p>
					</div>
					<button
						class="border border-dimmer bg-secondary px-2 py-1 text-sz-helper font-semibold text-dim hover:text-body"
						type="button"
						@click="clearSelectedMemory">
						×
					</button>
				</div>
				<p v-if="selectedMemory.body" class="m-0 mt-3 text-sz-helper leading-5 text-dim">{{ selectedMemory.body }}</p>
				<p class="mt-3 mb-0">
					<span :class="memoryStatusClass(selectedMemory.status)">{{ memoryStatusLabel(selectedMemory.status) }}</span>
				</p>
			</div>
			<div v-else class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">Select a Memory</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">Choose a row to inspect its Links and status.</p>
			</div>

			<div v-if="selectedMemory" class="px-3 py-3">
				<strong class="block font-semibold">Links</strong>
				<div v-if="orderedLinks.length === 0" class="mt-2 border border-dashed border-dimmer p-3 text-sz-helper text-dim">
					No Links.
				</div>
				<div v-else class="mt-2 grid gap-2">
					<div
						v-for="link in orderedLinks"
						:key="link.id"
						class="grid grid-cols-[86px_minmax(0,1fr)] gap-2 border border-dimmer bg-card px-2 py-2">
						<span class="text-sz-helper font-semibold text-primary">{{ link.type }}</span>
						<span class="min-w-0">
							<span class="block text-sz-helper">{{ linkSentence(link, selectedMemory) }}</span>
							<span class="block text-sz-micro text-dim">{{ isArchivedLink(link) ? 'Archived Link' : 'Current Link' }}</span>
						</span>
					</div>
				</div>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { usePortfolioMemoriesQuery } from '../../composables/portfolio-resource-queries'
import { useServerApi, type ServerApi } from '../../composables/useServerApi'
import { formatDate } from '../../utils/time'
import {
	draftFromInput,
	listMemoriesInputFromRoute,
	queryFromDraft,
	queryWithSelectedMemory,
	queryWithoutSelectedMemory,
	selectedMemoryIdFromRoute,
	type MemoryLedgerDraft,
} from './memory-ledger-state'

definePageMeta({ middleware: ['has-selection'] })

type ListedMemory = Awaited<ReturnType<ServerApi['listMemories']>>[number]
type MemoryLink = ListedMemory['links'][number]

const statusOptions = [
	{ value: 'current', label: 'Current' },
	{ value: 'superseded', label: 'Superseded' },
	{ value: 'all', label: 'All' },
] as const
const memoryTypeOptions = [
	{ value: 'all', label: 'All' },
	{ value: 'decision', label: 'Decision' },
	{ value: 'fact', label: 'Fact' },
	{ value: 'constraint', label: 'Constraint' },
	{ value: 'assumption', label: 'Assumption' },
	{ value: 'risk', label: 'Risk' },
	{ value: 'architecture', label: 'Architecture' },
	{ value: 'workflow', label: 'Workflow' },
	{ value: 'convention', label: 'Convention' },
	{ value: 'uncategorized', label: 'Uncategorized' },
] as const
const linkedByOptions = [
	{ value: 'any', label: 'Any' },
	{ value: 'produced', label: 'produced' },
	{ value: 'references', label: 'references' },
	{ value: 'supersedes', label: 'supersedes' },
	{ value: 'supports', label: 'supports' },
	{ value: 'contradicts', label: 'contradicts' },
] as const
const linkedToOptions = [
	{ value: 'any', label: 'Any' },
	{ value: 'project', label: 'Project' },
	{ value: 'plan', label: 'Plan' },
	{ value: 'delivery', label: 'Delivery' },
	{ value: 'slice', label: 'Slice' },
	{ value: 'memory', label: 'Memory' },
] as const

const route = useRoute()
const router = useRouter()
const serverApi = useServerApi()
const listInput = computed(() => listMemoriesInputFromRoute(route))
const draft = reactive<MemoryLedgerDraft>(draftFromInput(listInput.value))
const selectedMemoryId = computed(() => selectedMemoryIdFromRoute(route))
const {
	data: memories,
	isLoading: isLoadingMemories,
	error: memoriesError,
	hasExecuted: hasLoadedMemories,
} = usePortfolioMemoriesQuery(serverApi, listInput)

const isRefreshingMemories = computed(() => isLoadingMemories.value && hasLoadedMemories.value)
const selectedMemory = computed(() => memories.value.find((memory) => memory.id === selectedMemoryId.value) ?? null)
const orderedLinks = computed(() =>
	[...(selectedMemory.value?.links ?? [])].sort((left, right) => Number(isArchivedLink(left)) - Number(isArchivedLink(right))),
)

watch(listInput, (input) => Object.assign(draft, draftFromInput(input)))

function applyFilters() {
	void router.push({ path: route.path, query: queryFromDraft(draft, route.query) })
}

function selectMemory(memoryId: string) {
	void router.replace({ path: route.path, query: queryWithSelectedMemory(route.query, memoryId) })
}

function clearSelectedMemory() {
	void router.replace({ path: route.path, query: queryWithoutSelectedMemory(route.query) })
}

function memoryTypeLabel(type: ListedMemory['type']): string {
	return type === null ? 'Uncategorized' : titleCase(type)
}

function memoryStatusLabel(status: ListedMemory['status']): string {
	return titleCase(status)
}

function memoryStatusClass(status: ListedMemory['status']): string {
	const base = 'inline-flex border px-1.5 py-0.5 text-sz-micro font-semibold'
	return status === 'current' ? `${base} border-success/50 bg-success/10 text-success` : `${base} border-dimmer bg-secondary text-dim`
}

function activeLinkSummaries(memory: ListedMemory): Array<{ type: MemoryLink['type']; count: number }> {
	const counts = new Map<MemoryLink['type'], number>()
	for (const link of memory.links.filter((candidate) => !isArchivedLink(candidate)))
		counts.set(link.type, (counts.get(link.type) ?? 0) + 1)
	return [...counts.entries()].map(([type, count]) => ({ type, count }))
}

function linkSentence(link: MemoryLink, memory: ListedMemory): string {
	const incoming = link.to.type === 'memory' && link.to.id === memory.id
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

<style scoped>
.memory-filter-grid {
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr));
	align-items: end;
}

.memory-filter-grid :deep(label),
.memory-filter-grid :deep(input),
.memory-filter-grid :deep(select) {
	min-width: 0;
}

.memory-filter-grid :deep(input),
.memory-filter-grid :deep(select) {
	width: 100%;
}

.memory-preview {
	display: -webkit-box;
	overflow: hidden;
	-webkit-box-orient: vertical;
	line-clamp: 2;
	-webkit-line-clamp: 2;
}
</style>
