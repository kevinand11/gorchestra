<template>
	<NuxtLayout name="brain" title="Memory Ledger" subtitle="Search Portfolio Memories. Use the right rail filters to narrow the ledger.">
		<section>
			<div class="flex min-h-10 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
				<span class="text-sz-helper text-dim"
					>{{ memories.length }} {{ memories.length === 1 ? 'Memory' : 'Memories' }} · newest first</span
				>
				<div class="flex items-center gap-2">
					<span v-if="isRefreshingMemories" class="text-sz-helper text-dim">Refreshing Memories…</span>
					<NuxtLink
						to="/brain/memories/new"
						class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast hover:brightness-110">
						New Memory
					</NuxtLink>
				</div>
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
				<NuxtLink
					v-for="memory in memories"
					:key="memory.id"
					:to="`/brain/memories/${memory.id}`"
					class="grid w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-0 border-b border-dimmer bg-transparent px-3 py-2 text-left text-body hover:bg-card focus-visible:bg-secondary lg:grid-cols-[24px_minmax(0,1fr)_minmax(140px,auto)]">
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
				</NuxtLink>
			</div>
		</section>

		<template #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Filter Memories</div>
			<form class="grid gap-3 border-b border-dimmer bg-body-contrast/60 p-3" @submit.prevent="applyFilters">
				<label class="grid gap-1 text-sz-helper font-semibold text-dim">
					<span>Search title/body</span>
					<input
						v-model="draft.search"
						class="w-full border border-dimmer bg-canvas px-2 py-1.5 text-body"
						placeholder="route contract" />
				</label>
				<div class="grid gap-1 text-sz-helper font-semibold text-dim">
					<label for="memory-filter-status">Status</label>
					<UiSelect id="memory-filter-status" v-model="draft.status" :options="statusOptions" placeholder="Select status" />
				</div>
				<div class="grid gap-1 text-sz-helper font-semibold text-dim">
					<label for="memory-filter-type">Type</label>
					<UiSelect
						id="memory-filter-type"
						v-model="draft.memoryType"
						:options="memoryTypeOptions"
						placeholder="Select Memory Type" />
				</div>
				<div class="grid gap-1 text-sz-helper font-semibold text-dim">
					<label for="memory-filter-linked-by">Linked by</label>
					<UiSelect
						id="memory-filter-linked-by"
						v-model="draft.linkedBy"
						:options="linkedByOptions"
						placeholder="Select Link Type" />
				</div>
				<div class="grid gap-1 text-sz-helper font-semibold text-dim">
					<label for="memory-filter-linked-to">Linked to</label>
					<UiSelect
						id="memory-filter-linked-to"
						v-model="draft.linkedTo"
						:options="linkedToOptions"
						placeholder="Select Linked Node" />
				</div>
				<button
					class="justify-self-start border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast hover:brightness-110"
					type="submit">
					Apply
				</button>
			</form>
			<div class="px-3 py-3 text-sz-helper leading-5 text-dim">
				Filters update the ledger URL when applied. Opening a Memory uses a canonical detail URL.
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import UiSelect from '../../../components/ui/UiSelect.vue'
import { usePortfolioMemoriesQuery } from '../../../composables/portfolio-resource-queries.js'
import { useServerApi, type ServerApi } from '../../../composables/useServerApi.js'
import { formatDate } from '../../../utils/time.js'
import { draftFromInput, listMemoriesInputFromRoute, queryFromDraft, type MemoryLedgerDraft } from '../memory-ledger-state.js'

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
const {
	data: memories,
	isLoading: isLoadingMemories,
	error: memoriesError,
	hasExecuted: hasLoadedMemories,
} = usePortfolioMemoriesQuery(serverApi, listInput)

const isRefreshingMemories = computed(() => isLoadingMemories.value && hasLoadedMemories.value)

watch(listInput, (input) => Object.assign(draft, draftFromInput(input)))

function applyFilters() {
	void router.push({ path: route.path, query: queryFromDraft(draft, route.query) })
}

function memoryTypeLabel(type: ListedMemory['type']): string {
	return titleCase(type)
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

function isArchivedLink(link: MemoryLink): boolean {
	return link.archivePeriods.some((period) => period.unarchived === null)
}

function titleCase(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
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
