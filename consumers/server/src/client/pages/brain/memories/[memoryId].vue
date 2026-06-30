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
						{{ titleCase(memory.status) }} Memory · {{ titleCase(memory.type) }}
					</p>
					<h2 class="m-0 mt-2 max-w-[760px] text-[32px] leading-[1.08] font-semibold tracking-[-0.03em]">
						{{ memory.title }}
					</h2>
				</header>

				<div class="border-b border-dimmer px-3 py-2">
					<div class="flex flex-wrap gap-1.5">
						<span class="border border-dimmer bg-secondary px-1.5 py-0.5 text-sz-micro font-semibold text-dim">{{
							titleCase(memory.type)
						}}</span>
						<span :class="memoryStatusClass(memory.status)">{{ titleCase(memory.status) }}</span>
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
					<p class="m-0 text-sz-helper leading-5 text-dim">Create a newer Memory that supersedes this one.</p>
					<NuxtLink
						:to="{ path: '/brain/memories/new', query: { supersedes: memory.id } }"
						class="inline-flex mt-2 border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast hover:brightness-110">
						Supersede Memory
					</NuxtLink>
				</div>
			</div>
			<div class="flex items-center justify-between gap-2 border-b border-dimmer px-3 py-2">
				<span class="font-semibold">Links</span>
				<UiButton type="button" variant="secondary" @click="showLinkCreationForm = !showLinkCreationForm">
					{{ showLinkCreationForm ? 'Cancel' : 'Add Link' }}
				</UiButton>
			</div>
			<div v-if="showLinkCreationForm" class="border-b border-dimmer px-3 py-3">
				<form class="grid gap-3" @submit.prevent="createLink()">
					<div class="grid gap-1.5 text-sz-helper font-semibold text-dim">
						<label for="memory-link-type">Link Type</label>
						<UiSelect
							id="memory-link-type"
							v-model="linkCreationForm.type"
							:options="linkTypeOptions"
							placeholder="Select a Link Type"
							:invalid="!!linkCreationForm.errors.type" />
					</div>
					<UiText v-if="linkCreationForm.errors.type" tone="error" size="helper">
						{{ linkCreationForm.errors.type }}
					</UiText>

					<div class="grid gap-1.5 text-sz-helper font-semibold text-dim">
						<label for="memory-link-target">Target Memory</label>
						<UiSelect
							id="memory-link-target"
							v-model="linkCreationForm.targetMemoryId"
							:options="eligibleTargetMemoryOptions"
							placeholder="Select a target Memory"
							:disabled="isLoadingMemoryOptions && !hasLoadedMemoryOptions"
							:invalid="!!linkCreationForm.errors.targetMemoryId" />
					</div>
					<UiText v-if="linkCreationForm.errors.targetMemoryId" tone="error" size="helper">
						{{ linkCreationForm.errors.targetMemoryId }}
					</UiText>
					<UiText v-if="isLoadingMemoryOptions && !hasLoadedMemoryOptions" tone="muted" size="helper">Loading Memories…</UiText>
					<UiText v-else-if="memoryOptionsError" tone="error" size="helper">{{ memoryOptionsError }}</UiText>
					<UiText v-else-if="eligibleTargetMemories.length === 0" tone="muted" size="helper">
						No eligible target Memories for this Link Type.
					</UiText>
					<UiText v-else tone="muted" size="helper">
						Choose the existing Memory this Memory should {{ linkCreationForm.type }}.
					</UiText>

					<div>
						<UiButton type="submit" :loading="isCreatingLink" :disabled="!linkCreationForm.valid">Create Link</UiButton>
					</div>
					<UiText v-if="createLinkError" tone="error">{{ createLinkError }}</UiText>
				</form>
			</div>
			<div class="border-b border-dimmer px-3 py-3 text-sz-helper leading-5 text-dim">
				Active Links appear first. References, Supports, and Contradicts Links can be archived or unarchived here.
			</div>
			<UiText v-if="setLinkArchiveStateError" class="border-b border-dimmer px-3 py-3" tone="error">
				{{ setLinkArchiveStateError }}
			</UiText>
			<div v-if="orderedLinks.length === 0" class="border-b border-dimmer px-3 py-3 text-sz-helper text-dim">No Links.</div>
			<div v-else>
				<div
					v-for="link in orderedLinks"
					:key="link.id"
					class="border-b border-dimmer px-3 py-3"
					:class="isArchivedLink(link) ? 'opacity-75' : ''">
					<span class="block text-sz-helper font-semibold text-primary">{{ link.type }}</span>
					<span class="mt-1 block text-sz-helper leading-5">{{ linkSentence(link, memory) }}</span>
					<div class="mt-2 flex items-center justify-between gap-2">
						<span class="block text-sz-micro text-dim">{{ isArchivedLink(link) ? 'Archived Link' : 'Current Link' }}</span>
						<UiButton
							v-if="isArchivableLink(link)"
							type="button"
							variant="secondary"
							:loading="isUpdatingLinkArchiveState(link)"
							:disabled="isSettingLinkArchiveState"
							@click="setLinkArchiveState(link)">
							{{ isArchivedLink(link) ? 'Unarchive' : 'Archive' }}
						</UiButton>
					</div>
				</div>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import UiButton from '../../../components/ui/UiButton.vue'
import UiSelect from '../../../components/ui/UiSelect.vue'
import UiText from '../../../components/ui/UiText.vue'
import { useApiAction } from '../../../composables/action-state'
import { usePortfolioMemoriesQuery, usePortfolioMemoryQuery } from '../../../composables/portfolio-resource-queries'
import { useQueryCache } from '../../../composables/query-cache'
import { useSelectedPortfolio } from '../../../composables/selected-portfolio'
import { useToasts } from '../../../composables/toasts'
import { useServerApi, type ListMemoriesInput, type ServerApi } from '../../../composables/useServerApi'
import { LinkCreationFormDraft, memoryLinkCreationTypeOptions } from '../../../forms/link'
import { formatDate } from '../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type ListedMemory = Awaited<ReturnType<ServerApi['listMemories']>>[number]
type MemoryDetails = Awaited<ReturnType<ServerApi['getMemory']>>
type MemoryLink = MemoryDetails['links'][number]

const route = useRoute()
const serverApi = useServerApi()
const toasts = useToasts()
const { portfolio } = useSelectedPortfolio()
const { queryKeys, invalidate, set } = useQueryCache()
const memoryId = computed(() => route.params.memoryId as string)
const showLinkCreationForm = ref(false)
const linkTypeOptions = memoryLinkCreationTypeOptions
const archivableLinkTypes = new Set<MemoryLink['type']>(['references', 'supports', 'contradicts'])
const linkCreationForm = new LinkCreationFormDraft({ sourceMemoryId: memoryId.value })
const updatingLinkArchiveStateId = ref<string | null>(null)
const allMemoriesInput = computed<ListMemoriesInput>(() => ({
	status: 'all',
	search: null,
	typeFilter: { type: 'all' },
	linkFilter: { type: 'none' },
}))

const {
	data: memory,
	isLoading: isLoadingMemory,
	error: memoryError,
	hasExecuted: hasLoadedMemory,
} = usePortfolioMemoryQuery(serverApi, memoryId)

const {
	data: memoryOptions,
	isLoading: isLoadingMemoryOptions,
	error: memoryOptionsError,
	hasExecuted: hasLoadedMemoryOptions,
} = usePortfolioMemoriesQuery(serverApi, allMemoriesInput)

const orderedLinks = computed(() =>
	[...(memory.value?.links ?? [])].sort((left, right) => Number(isArchivedLink(left)) - Number(isArchivedLink(right))),
)
const eligibleTargetMemories = computed(() => {
	const duplicateTargetIds = new Set((memory.value?.links ?? []).flatMap((link) => [link.from.id, link.to.id]))
	return memoryOptions.value.filter((option) => !duplicateTargetIds.has(option.id))
})
const eligibleTargetMemoryOptions = computed(() =>
	eligibleTargetMemories.value.map((memory) => ({ value: memory.id, label: memoryOptionLabel(memory) })),
)

watch(memoryId, (sourceId) => {
	linkCreationForm.sourceMemoryId = sourceId
})

const {
	isLoading: isCreatingLink,
	error: createLinkError,
	execute: createLink,
} = useApiAction(async () => {
	const link = await serverApi.createLink(linkCreationForm.toModel())
	if (memory.value)
		set(queryKeys.portfolio.memory(portfolio.value.id, memory.value.id), { ...memory.value, links: [...memory.value.links, link] })
	invalidatePortfolioMemories()
	linkCreationForm.reset()
	toasts.success({ title: 'Link created.', body: `${titleCase(link.type)} Link added.` })
})

const {
	isLoading: isSettingLinkArchiveState,
	error: setLinkArchiveStateError,
	execute: setLinkArchiveState,
} = useApiAction(async (link: MemoryLink) => {
	updatingLinkArchiveStateId.value = link.id
	try {
		const archived = !isArchivedLink(link)
		const updatedLink = await serverApi.setLinkArchiveState(link.id, archived)
		replaceCachedMemoryLink(updatedLink)
		invalidatePortfolioMemories()
		toasts.success({ title: archived ? 'Link archived.' : 'Link unarchived.', body: `${titleCase(link.type)} Link updated.` })
	} finally {
		updatingLinkArchiveStateId.value = null
	}
})

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

function isArchivableLink(link: MemoryLink): boolean {
	return archivableLinkTypes.has(link.type)
}

function isUpdatingLinkArchiveState(link: MemoryLink): boolean {
	return isSettingLinkArchiveState.value && updatingLinkArchiveStateId.value === link.id
}

function isArchivedLink(link: MemoryLink): boolean {
	return link.archivePeriods.some((period) => period.unarchived === null)
}

function replaceCachedMemoryLink(link: MemoryLink): void {
	if (!memory.value) return

	set(queryKeys.portfolio.memory(portfolio.value.id, memory.value.id), {
		...memory.value,
		links: memory.value.links.map((existingLink) => (existingLink.id === link.id ? link : existingLink)),
	})
}

function invalidatePortfolioMemories(): void {
	invalidate([...queryKeys.portfolio.root(portfolio.value.id), 'memories'])
}

function memoryOptionLabel(memory: ListedMemory): string {
	return `${memory.title} — ${titleCase(memory.status)} — ${titleCase(memory.type)}`
}

function titleCase(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
</script>
