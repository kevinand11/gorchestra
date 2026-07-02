<template>
	<NuxtLayout name="project" :project-id="projectId">
		<section>
			<div v-if="isLoadingDelivery && !hasLoadedDelivery" class="border-b border-dimmer px-3 py-4 text-dim">Loading Delivery…</div>
			<p v-if="isRefreshingDelivery" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">Refreshing Delivery…</p>
			<div v-else-if="deliveryError" class="border-b border-dimmer px-3 py-4 text-error">{{ deliveryError }}</div>
			<div v-else-if="delivery" class="grid gap-0">
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">{{ delivery.title }}</h2>
					<div class="mt-2 grid gap-2 text-sz-helper sm:grid-cols-2">
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Status</span><span :class="deliveryStatusTextClass">{{ deliveryStatusLabel }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Accepted</span><span>{{ formatDate(delivery.accepted.at) }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Repository</span><span>{{ repositoryLabel }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Target branch</span><span>{{ delivery.target.targetBranch }}</span>
						</div>
					</div>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Slices</h2>
					<div v-if="delivery.slices.length === 0" class="mt-3 border border-dashed border-dimmer p-3 text-sz-helper text-dim">
						No Slices are attached to this Delivery.
					</div>
					<div v-else class="mt-3 grid gap-2">
						<div v-for="slice in delivery.slices" :key="slice.id" class="border border-dimmer bg-card p-3">
							<div class="flex items-start justify-between gap-3">
								<strong class="font-semibold">{{ slice.title }}</strong>
								<span class="shrink-0 text-sz-micro text-dim">Slice {{ slice.order + 1 }}</span>
							</div>
							<p class="m-0 mt-2 text-sz-helper leading-5 text-dim">{{ slice.instruction.body }}</p>
						</div>
					</div>
				</section>

				<section class="px-3 py-3">
					<div class="border border-dimmer bg-card p-3">
						<strong class="block font-semibold">Delivery execution is not available yet.</strong>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							This page reads materialized Delivery facts. Queueing and running Delivery work are separate future slices.
						</p>
					</div>
				</section>
			</div>
		</section>

		<template v-if="delivery" #right>
			<div class="border-b border-dimmer px-3 py-2 font-semibold">Materialization</div>
			<div class="border-b border-dimmer px-3 py-3">
				<strong class="block font-semibold">Accepted Plan Output</strong>
				<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
					This Delivery was materialized from an accepted Plan Output. Plan Output review is not exposed in this slice.
				</p>
			</div>
			<div class="px-3 py-3">
				<NuxtLink
					class="inline-flex border border-dimmer bg-secondary px-3 py-1.5 text-sz-helper font-semibold text-secondary-contrast hover:bg-card"
					:to="`/projects/${projectId}/plans/${delivery.planId}`">
					View source Plan
				</NuxtLink>
			</div>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useDeliveryDetail } from '../../../../composables/portfolio/project/deliveries'
import { formatDate } from '../../../../utils/time'
import { deliveryStateForDisplay, type DeliveryState } from './display'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const projectId = computed(() => route.params.projectId as string)
const deliveryId = computed(() => route.params.deliveryId as string)
const { delivery, isLoadingDelivery, deliveryError, hasLoadedDelivery, isRefreshingDelivery } = useDeliveryDetail(projectId, deliveryId)

const repositoryLabel = computed(() => {
	if (delivery.value === null) return ''
	return `${delivery.value.target.repository.config.owner}/${delivery.value.target.repository.config.name}`
})
const deliveryStateDisplay = {
	shipped: { label: 'Shipped', textClass: 'text-success' },
	abandoned: { label: 'Abandoned', textClass: 'text-dim' },
	queued: { label: 'Queued', textClass: 'text-primary' },
	accepted: { label: 'Accepted', textClass: 'text-primary' },
} as const

const deliveryState = computed<DeliveryState>(() => deliveryStateForDisplay(delivery.value))
const deliveryStatusLabel = computed(() => deliveryStateDisplay[deliveryState.value].label)
const deliveryStatusTextClass = computed(() => deliveryStateDisplay[deliveryState.value].textClass)
</script>
