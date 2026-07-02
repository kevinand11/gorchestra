<template>
	<NuxtLayout name="brain" title="Memory Detail" subtitle="Inspect and revise one Portfolio Memory.">
		<section>
			<div v-if="isLoadingMemory && !hasLoadedMemory" class="border-b border-dimmer px-3 py-4 text-dim">Loading Memory…</div>
			<p v-if="isRefreshingMemory" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">Refreshing Memory…</p>
			<div v-else-if="memoryError" class="border-b border-dimmer px-3 py-4 text-error">{{ memoryError }}</div>
			<article v-else-if="memory && shownRevision">
				<header class="border-b border-dimmer px-3 py-3">
					<nav class="flex flex-wrap gap-2 text-sz-helper" aria-label="Memory hierarchy">
						<NuxtLink class="text-dim hover:text-primary" to="/brain/memories">Root Memories</NuxtLink>
						<NuxtLink v-if="memory.parentId" class="text-dim hover:text-primary" :to="`/brain/memories/${memory.parentId}`">
							/ Parent Memory
						</NuxtLink>
					</nav>

					<div v-if="!isEditingMemory" class="mt-3">
						<p class="m-0 text-sz-tiny font-bold uppercase tracking-[0.08em] text-primary">
							{{ isViewingHistoricalRevision ? 'Historical revision' : 'Current Memory' }}
						</p>
						<h2 class="m-0 mt-2 max-w-[760px] text-[32px] leading-[1.08] font-semibold tracking-[-0.03em]">
							{{ shownRevision.title }}
						</h2>
						<div class="mt-2 flex flex-wrap gap-2 text-sz-micro text-dim">
							<span>Created {{ formatDate(memory.created.at) }}</span>
							<span>Current revision {{ formatDate(memory.currentRevision.created.at) }}</span>
						</div>
					</div>
				</header>

				<div v-if="isViewingHistoricalRevision && !isEditingMemory" class="border-b border-info bg-secondary px-3 py-3">
					<strong class="block text-sz-helper text-info">Viewing a historical revision</strong>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						This content was saved {{ formatDate(shownRevision.created.at) }}. Current Memory content may be different.
					</p>
					<UiButton class="mt-2" type="button" variant="secondary" @click="backToCurrentRevision">Back to current</UiButton>
				</div>

				<section v-if="isEditingMemory" class="max-w-[860px] border-b border-dimmer bg-body-contrast/60 px-3 py-3">
					<h2 class="m-0 mb-3 text-sz-subsection font-semibold">Edit current Memory</h2>
					<MemoryForm
						:draft="revisionForm"
						title-id="memory-edit-title"
						body-id="memory-edit-body"
						submit-label="Save revision"
						title-placeholder="Memory title"
						body-placeholder="Revise the Memory body…"
						:loading="isSavingRevision"
						:disabled="isSaveRevisionDisabled"
						:error="saveRevisionError"
						show-cancel
						@submit="saveRevision()"
						@cancel="cancelEditing" />
				</section>

				<section v-else class="max-w-[860px] border-b border-dimmer px-3 py-4">
					<p v-if="shownRevision.body" class="m-0 whitespace-pre-wrap text-sz-body leading-7 text-body">
						{{ shownRevision.body }}
					</p>
					<p v-else class="m-0 text-sz-helper leading-5 text-dim">This Memory has no body.</p>
				</section>

				<section>
					<div class="flex min-h-10 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
						<span class="font-semibold">Child Memories</span>
						<UiButton type="button" variant="secondary" @click="toggleChildCreationForm">
							{{ showChildCreationForm ? 'Close' : 'New child Memory' }}
						</UiButton>
					</div>
					<div v-if="showChildCreationForm" class="border-b border-dimmer bg-body-contrast/60 px-3 py-3">
						<MemoryForm
							:draft="childCreationForm"
							title-id="child-memory-title"
							body-id="child-memory-body"
							submit-label="Create child Memory"
							title-placeholder="Decision details"
							body-placeholder="Capture child context…"
							:loading="isCreatingChildMemory"
							:error="createChildMemoryError"
							show-cancel
							@submit="createChildMemory()"
							@cancel="hideChildCreationForm" />
					</div>
					<div v-if="memory.children.length === 0" class="border-b border-dimmer px-3 py-4 text-sz-helper text-dim">
						No child Memories.
					</div>
					<MemoryRow v-for="child in memory.children" :key="child.id" :memory="child" :to="`/brain/memories/${child.id}`" />
				</section>
			</article>
		</section>

		<template v-if="memory" #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Actions</div>
			<div class="border-b border-dimmer px-3 py-3">
				<UiButton type="button" variant="secondary" :disabled="isEditingMemory" @click="startEditing">
					{{ isEditingMemory ? 'Editing current Memory' : 'Edit current Memory' }}
				</UiButton>
				<p class="m-0 mt-2 text-sz-helper leading-5 text-dim">
					Editing saves a new revision. Parent placement does not change in this slice.
				</p>
			</div>

			<div class="border-b border-dimmer px-3 py-2 font-semibold">Revision history</div>
			<div v-for="revision in memory.revisions" :key="revision.id" class="border-b border-dimmer px-3 py-3">
				<NuxtLink
					:to="revisionRoute(revision.id)"
					class="block border-l-2 pl-2 text-sz-helper font-semibold hover:text-primary"
					:class="revisionClass(revision.id)">
					{{ revision.title }}
				</NuxtLink>
				<div class="mt-1 flex flex-wrap gap-1.5 pl-3 text-sz-micro text-dim">
					<span>{{ formatDate(revision.created.at) }}</span>
					<span v-if="revision.id === memory.currentRevision.id">Current</span>
					<span v-if="revision.id === selectedRevisionId && revision.id !== memory.currentRevision.id">Selected</span>
				</div>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import MemoryForm from '../../../components/brain/MemoryForm.vue'
import MemoryRow from '../../../components/brain/MemoryRow.vue'
import UiButton from '../../../components/ui/UiButton.vue'
import { useMemoryCreate, useMemoryDetail, useMemoryRevisionCreate, type MemoryDetails } from '../../../composables/portfolio/memories'
import { formatDate } from '../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type MemoryRevisionDisplay = MemoryDetails['currentRevision']

const route = useRoute()
const router = useRouter()
const memoryId = computed(() => route.params.memoryId as string)
const revisionId = computed(() => (typeof route.query.revisionId === 'string' ? route.query.revisionId : null))
const isEditingMemory = ref(false)
const showChildCreationForm = ref(false)

const { memory, isLoadingMemory, memoryError, hasLoadedMemory, isRefreshingMemory } = useMemoryDetail(memoryId)
const {
	memoryRevisionForm: revisionForm,
	isSavingRevision,
	saveRevisionError,
	saveRevision,
} = useMemoryRevisionCreate(memoryId, {
	onSuccess: async (updatedMemory) => {
		loadRevisionForm(updatedMemory.currentRevision)
		isEditingMemory.value = false
		await backToCurrentRevision()
	},
})
const {
	memoryCreationForm: childCreationForm,
	isCreatingMemory: isCreatingChildMemory,
	createMemoryError: createChildMemoryError,
	createMemory: createChildMemory,
} = useMemoryCreate(memoryId, {
	onSuccess: async (child) => {
		showChildCreationForm.value = false
		await navigateTo(`/brain/memories/${child.id}`)
	},
})

const selectedRevision = computed(() => {
	if (memory.value === null) return null
	return memory.value.revisions.find((revision) => revision.id === revisionId.value) ?? null
})
const shownRevision = computed<MemoryRevisionDisplay | null>(() => selectedRevision.value ?? memory.value?.currentRevision ?? null)
const selectedRevisionId = computed(() => shownRevision.value?.id ?? null)
const isViewingHistoricalRevision = computed(
	() => memory.value !== null && selectedRevision.value !== null && selectedRevision.value.id !== memory.value.currentRevision.id,
)
const isSaveRevisionDisabled = computed(() => !revisionForm.isDirty('title', 'body'))

watch(memoryId, () => {
	isEditingMemory.value = false
	showChildCreationForm.value = false
	childCreationForm.reset()
})

watch(
	() => memory.value?.currentRevision.id,
	() => {
		if (!isEditingMemory.value) loadRevisionFormFromCurrentMemory()
	},
)

function startEditing(): void {
	loadRevisionFormFromCurrentMemory()
	isEditingMemory.value = true
	void backToCurrentRevision()
}

function cancelEditing(): void {
	revisionForm.reset()
	isEditingMemory.value = false
}

function toggleChildCreationForm(): void {
	showChildCreationForm.value = !showChildCreationForm.value
}

function hideChildCreationForm(): void {
	childCreationForm.reset()
	showChildCreationForm.value = false
}

function revisionRoute(revisionId: string): { path: string; query?: { revisionId: string } } {
	return revisionId === memory.value?.currentRevision.id ? { path: route.path } : { path: route.path, query: { revisionId } }
}

function revisionClass(revisionId: string): string {
	return revisionId === selectedRevisionId.value ? 'border-primary text-primary' : 'border-transparent text-body'
}

async function backToCurrentRevision(): Promise<void> {
	await router.replace({ path: route.path })
}

function loadRevisionFormFromCurrentMemory(): void {
	if (memory.value === null) return
	loadRevisionForm(memory.value.currentRevision)
}

function loadRevisionForm(revision: MemoryRevisionDisplay): void {
	revisionForm.loadEntity({ expectedCurrentRevisionId: revision.id, title: revision.title, body: revision.body })
}
</script>
