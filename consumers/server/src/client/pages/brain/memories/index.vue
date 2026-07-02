<template>
	<NuxtLayout name="brain" title="Memories" subtitle="Browse root Portfolio Memories.">
		<section>
			<div class="flex min-h-10 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
				<span class="text-sz-helper text-dim"
					>{{ memories.length }} {{ memories.length === 1 ? 'root Memory' : 'root Memories' }}</span
				>
				<div class="flex items-center gap-2">
					<span v-if="isRefreshingMemories" class="text-sz-helper text-dim">Refreshing Memories…</span>
					<UiButton type="button" variant="secondary" @click="toggleCreationForm">
						{{ showCreationForm ? 'Close' : 'New root Memory' }}
					</UiButton>
				</div>
			</div>

			<div v-if="showCreationForm" class="border-b border-dimmer bg-body-contrast/60 px-3 py-3">
				<MemoryForm
					:draft="creationForm"
					title-id="root-memory-title"
					body-id="root-memory-body"
					submit-label="Create Memory"
					title-placeholder="Architecture notes"
					body-placeholder="Capture durable Portfolio context…"
					:loading="isCreatingMemory"
					:error="createMemoryError"
					show-cancel
					@submit="createMemory()"
					@cancel="hideCreationForm" />
			</div>

			<div v-if="isLoadingMemories && !hasLoadedMemories" class="border-b border-dimmer px-3 py-4 text-dim">Loading Memories…</div>
			<div v-else-if="memoriesError" class="border-b border-dimmer px-3 py-4 text-error">{{ memoriesError }}</div>
			<div v-else-if="memories.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Memories yet.</h2>
				<p class="m-0 mt-1 max-w-[680px] text-sz-helper leading-5 text-dim">
					Create a root Memory to start shaping this Portfolio's second brain. Every Memory can later contain child Memories.
				</p>
			</div>
			<div v-else>
				<MemoryRow v-for="memory in memories" :key="memory.id" :memory="memory" :to="`/brain/memories/${memory.id}`" />
			</div>
		</section>

		<template #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">About Memories</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">Portfolio context that lasts</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					Use Memories for decisions, constraints, conventions, and other context Gorchestra should carry across planning and
					delivery.
				</p>
			</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">Start broad, then go deeper</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					Root Memories work best for durable topics. Add child Memories for details, examples, and follow-up notes that belong
					under them.
				</p>
			</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">Keep each Memory focused</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					Choose a clear title and capture one useful idea at a time so the Portfolio Brain stays easy to navigate.
				</p>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import MemoryForm from '../../../components/brain/MemoryForm.vue'
import MemoryRow from '../../../components/brain/MemoryRow.vue'
import UiButton from '../../../components/ui/UiButton.vue'
import { useMemoryChildren, useMemoryCreate } from '../../../composables/portfolio/memories'

definePageMeta({ middleware: ['has-selection'] })

const rootParentId = computed(() => null as string | null)
const showCreationForm = ref(false)
const { memories, isLoadingMemories, memoriesError, hasLoadedMemories, isRefreshingMemories } = useMemoryChildren(rootParentId)
const {
	memoryCreationForm: creationForm,
	isCreatingMemory,
	createMemoryError,
	createMemory,
} = useMemoryCreate(rootParentId, {
	onSuccess: async (memory) => {
		showCreationForm.value = false
		await navigateTo(`/brain/memories/${memory.id}`)
	},
})

function toggleCreationForm(): void {
	showCreationForm.value = !showCreationForm.value
}

function hideCreationForm(): void {
	creationForm.reset()
	showCreationForm.value = false
}
</script>
