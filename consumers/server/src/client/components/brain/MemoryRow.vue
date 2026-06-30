<template>
	<NuxtLink
		:to="to"
		class="grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-2 border-0 border-b border-dimmer bg-transparent px-3 py-2 text-left text-body hover:bg-card focus-visible:bg-secondary">
		<span class="mt-0.5 grid size-5 place-items-center border border-dimmer text-sz-micro font-semibold text-dim">M</span>
		<span class="min-w-0">
			<strong class="block truncate font-semibold">{{ memory.currentRevision.title }}</strong>
			<span v-if="memory.currentRevision.body" class="memory-preview mt-0.5 text-sz-helper text-dim">
				{{ memory.currentRevision.body }}
			</span>
		</span>
		<span class="hidden whitespace-nowrap text-sz-micro text-dim sm:block">{{ formatDate(memory.created.at) }}</span>
	</NuxtLink>
</template>

<script setup lang="ts">
import { formatDate } from '../../utils/time'

defineProps<{
	memory: {
		id: string
		created: { at: string }
		currentRevision: {
			title: string
			body: string
		}
	}
	to: string
}>()
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
