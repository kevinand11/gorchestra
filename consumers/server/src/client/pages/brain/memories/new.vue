<template>
	<NuxtLayout
		name="brain"
		title="New Memory"
		subtitle="Preserve a decision, fact, constraint, assumption, risk, architecture note, workflow, or convention for this Portfolio.">
		<section class="px-3 py-3">
			<form class="grid max-w-[620px] gap-3" @submit.prevent="createMemory()">
				<label class="grid gap-1.5 font-semibold" for="memory-title">
					Title
					<UiInput
						id="memory-title"
						v-model="memoryCreationForm.title"
						required
						placeholder="Route contracts remain the Server API type source"
						:invalid="!!memoryCreationForm.errors.title" />
				</label>
				<UiText v-if="memoryCreationForm.errors.title" tone="error" size="helper">
					{{ memoryCreationForm.errors.title }}
				</UiText>

				<label class="grid gap-1.5 font-semibold" for="memory-type">
					Type
					<UiSelect id="memory-type" v-model="memoryCreationForm.memoryType">
						<option v-for="option in memoryTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
					</UiSelect>
				</label>

				<label class="grid gap-1.5 font-semibold" for="memory-body">
					Body
					<textarea
						id="memory-body"
						v-model="memoryCreationForm.body"
						class="min-h-[220px] w-full resize-y border border-dimmer bg-input px-2.5 py-2 leading-6 text-input-contrast outline-none placeholder:text-dim focus:border-primary"
						placeholder="Write the context this Memory should preserve." />
				</label>
				<UiText tone="muted" size="helper">Body is optional. Whitespace-only bodies are saved as empty.</UiText>

				<div class="flex flex-wrap items-center gap-2">
					<UiButton type="submit" :loading="isCreatingMemory" :disabled="!memoryCreationForm.valid">Create Memory</UiButton>
					<NuxtLink
						to="/brain/memories"
						class="inline-flex items-center justify-center border border-dimmer bg-secondary px-3 py-1.5 text-sz-helper font-semibold text-secondary-contrast no-underline hover:border-dim hover:brightness-110">
						Cancel
					</NuxtLink>
				</div>
				<UiText v-if="createMemoryError" tone="error">{{ createMemoryError }}</UiText>
			</form>
		</section>

		<template #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Supersession</div>
			<div class="grid gap-3 border-b border-dimmer px-3 py-3">
				<label class="grid gap-1.5 text-sz-helper font-semibold text-dim" for="superseded-memory">
					Superseded Memory
					<UiSelect id="superseded-memory" v-model="memoryCreationForm.supersededMemoryId">
						<option value="">No superseded Memory</option>
						<option v-for="memory in memoryOptions" :key="memory.id" :value="memory.id">
							{{ memoryOptionLabel(memory) }}
						</option>
					</UiSelect>
				</label>
				<UiText v-if="isLoadingMemoryOptions && !hasLoadedMemoryOptions" tone="muted" size="helper"> Loading Memories… </UiText>
				<UiText v-else-if="memoryOptionsError" tone="error" size="helper">{{ memoryOptionsError }}</UiText>
				<UiText v-else tone="muted" size="helper"> Choose an older Memory only when this new Memory should replace it. </UiText>
			</div>

			<div class="border-b border-dimmer px-3 py-2 font-semibold">What gets created</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">An immutable Memory</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					A Memory is immutable after creation. If this Memory replaces older context, choose a Superseded Memory before creating
					it.
				</p>
			</div>
			<div class="px-3 py-3">
				<strong class="block font-semibold">Portfolio context</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">This Memory belongs to {{ portfolio.displayName }}.</p>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import UiButton from '../../../components/ui/UiButton.vue'
import UiInput from '../../../components/ui/UiInput.vue'
import UiSelect from '../../../components/ui/UiSelect.vue'
import UiText from '../../../components/ui/UiText.vue'
import { useApiAction } from '../../../composables/action-state'
import { usePortfolioMemoriesQuery } from '../../../composables/portfolio-resource-queries'
import { useQueryCache } from '../../../composables/query-cache'
import { useSelectedPortfolio } from '../../../composables/selected-portfolio'
import { useServerApi, type ListMemoriesInput, type ServerApi } from '../../../composables/useServerApi'
import { useToasts } from '../../../composables/toasts'
import { MemoryCreationFormFactory } from '../../../forms/memory'

definePageMeta({ middleware: ['has-selection'] })

type ListedMemory = Awaited<ReturnType<ServerApi['listMemories']>>[number]

const memoryTypeOptions = [
	{ value: 'uncategorized', label: 'Uncategorized' },
	{ value: 'decision', label: 'Decision' },
	{ value: 'fact', label: 'Fact' },
	{ value: 'constraint', label: 'Constraint' },
	{ value: 'assumption', label: 'Assumption' },
	{ value: 'risk', label: 'Risk' },
	{ value: 'architecture', label: 'Architecture' },
	{ value: 'workflow', label: 'Workflow' },
	{ value: 'convention', label: 'Convention' },
] as const

const allMemoriesInput = computed<ListMemoriesInput>(() => ({
	status: 'all',
	search: null,
	typeFilter: { type: 'all' },
	linkFilter: { type: 'none' },
}))

const route = useRoute()
const { portfolio } = useSelectedPortfolio()
const serverApi = useServerApi()
const toasts = useToasts()
const { queryKeys, invalidate } = useQueryCache()
const memoryCreationForm = new MemoryCreationFormFactory()
const initialSupersededMemoryId = supersededMemoryIdFromQuery(route.query.supersedes)
if (initialSupersededMemoryId !== '') memoryCreationForm.supersededMemoryId = initialSupersededMemoryId

const {
	data: memoryOptions,
	isLoading: isLoadingMemoryOptions,
	error: memoryOptionsError,
	hasExecuted: hasLoadedMemoryOptions,
} = usePortfolioMemoriesQuery(serverApi, allMemoriesInput)

watch(
	[memoryOptions, hasLoadedMemoryOptions],
	([options, hasLoaded]) => {
		if (!hasLoaded || memoryCreationForm.supersededMemoryId === '') return
		if (!options.some((memory) => memory.id === memoryCreationForm.supersededMemoryId)) memoryCreationForm.supersededMemoryId = ''
	},
	{ immediate: true },
)

const {
	isLoading: isCreatingMemory,
	error: createMemoryError,
	execute: createMemory,
} = useApiAction(async () => {
	const memory = await serverApi.createMemory(memoryCreationForm.toModel())
	invalidate([...queryKeys.portfolio.root(portfolio.value.id), 'memories'])
	toasts.success({ title: 'Memory created.', body: memory.title })
	await navigateTo(`/brain/memories/${memory.id}`)
})

function memoryOptionLabel(memory: ListedMemory): string {
	return `${memory.title} — ${memoryStatusLabel(memory.status)} — ${memoryTypeLabel(memory.type)}`
}

function memoryStatusLabel(status: ListedMemory['status']): string {
	return titleCase(status)
}

function memoryTypeLabel(type: ListedMemory['type']): string {
	return type === null ? 'Uncategorized' : titleCase(type)
}

function supersededMemoryIdFromQuery(value: unknown): string {
	const candidate = firstQueryValue(value)
	if (candidate === null) return ''
	const trimmed = candidate.trim()
	return trimmed.length === 0 ? '' : trimmed
}

function firstQueryValue(value: unknown): string | null {
	if (typeof value === 'string') return value
	if (Array.isArray(value)) return value.find((candidate): candidate is string => typeof candidate === 'string') ?? null
	return null
}

function titleCase(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
</script>
