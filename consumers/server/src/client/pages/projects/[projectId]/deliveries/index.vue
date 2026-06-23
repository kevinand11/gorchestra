<template>
	<NuxtLayout name="project" :project-id="projectId">
		<section>
			<div class="flex min-h-11 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
				<span class="text-sz-helper text-dim"
					>{{ deliveries.length }} {{ deliveries.length === 1 ? 'Delivery' : 'Deliveries' }}</span
				>
			</div>

			<div v-if="isLoadingDeliveries && !hasLoadedDeliveries" class="border-b border-dimmer px-3 py-4 text-dim">
				Loading Deliveries…
			</div>
			<div v-else-if="deliveriesError" class="border-b border-dimmer px-3 py-4 text-error">{{ deliveriesError }}</div>
			<div v-else-if="deliveries.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Deliveries yet.</h2>
				<p class="m-0 mt-1 max-w-[680px] text-sz-helper leading-5 text-dim">
					Deliveries are created when an accepted Plan Output materializes executable work for this Project. Plan Output
					generation is not available in this slice.
				</p>
			</div>
			<div v-else>
				<NuxtLink
					v-for="delivery in deliveries"
					:key="delivery.id"
					:to="`/projects/${projectId}/deliveries/${delivery.id}`"
					class="grid min-h-[62px] grid-cols-[24px_minmax(0,1fr)_110px] items-center gap-2 border-b border-dimmer px-3 py-2 text-body no-underline hover:bg-card focus-visible:bg-secondary">
					<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">D</span>
					<span class="min-w-0">
						<strong class="block truncate font-semibold">{{ delivery.title }}</strong>
						<span class="mt-0.5 flex flex-wrap gap-2 text-sz-helper text-dim">
							<span>{{ repositoryLabel(delivery) }}</span>
							<span>{{ delivery.target.targetBranch }}</span>
							<span>{{ sliceCountLabel(delivery.slices.length) }}</span>
						</span>
					</span>
					<span class="justify-self-start" :class="deliveryStatusClass(delivery)">
						<span class="size-2 rounded-full bg-current" />
						{{ deliveryStatusLabel(delivery) }}
					</span>
				</NuxtLink>
			</div>
			<p v-if="isLoadingDeliveries && hasLoadedDeliveries" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Deliveries…
			</p>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { usePortfolioDeliveriesQuery } from '../../../../composables/portfolio-resource-queries'
import { useServerApi, type ServerApi } from '../../../../composables/useServerApi'
import { deliveryStateForDisplay, type DeliveryState } from './display'

definePageMeta({ middleware: ['has-selection'] })

type ListedDelivery = Awaited<ReturnType<ServerApi['listDeliveries']>>[number]

const route = useRoute()
const serverApi = useServerApi()
const projectId = computed(() => route.params.projectId as string)
const {
	data: deliveries,
	isLoading: isLoadingDeliveries,
	error: deliveriesError,
	hasExecuted: hasLoadedDeliveries,
} = usePortfolioDeliveriesQuery(serverApi, projectId)

function repositoryLabel(delivery: ListedDelivery): string {
	return `${delivery.target.repository.config.owner}/${delivery.target.repository.config.name}`
}

function sliceCountLabel(count: number): string {
	return `${count} ${count === 1 ? 'Slice' : 'Slices'}`
}

const deliveryStateDisplay = {
	shipped: {
		label: 'shipped',
		className:
			'inline-flex items-center gap-1 border px-2 py-0.5 text-sz-micro font-semibold border-success/50 bg-success/10 text-success',
	},
	abandoned: {
		label: 'abandoned',
		className: 'inline-flex items-center gap-1 border px-2 py-0.5 text-sz-micro font-semibold border-dimmer bg-secondary text-dim',
	},
	queued: {
		label: 'queued',
		className:
			'inline-flex items-center gap-1 border px-2 py-0.5 text-sz-micro font-semibold border-primary/50 bg-primary/10 text-primary',
	},
	accepted: {
		label: 'accepted',
		className:
			'inline-flex items-center gap-1 border px-2 py-0.5 text-sz-micro font-semibold border-primary/50 bg-primary/10 text-primary',
	},
} as const

function deliveryStatusLabel(delivery: ListedDelivery): string {
	return deliveryStateDisplay[deliveryStateForDisplay(delivery)].label
}

function deliveryStatusClass(delivery: ListedDelivery): string {
	return deliveryStateDisplay[deliveryStateForDisplay(delivery)].className
}
</script>
