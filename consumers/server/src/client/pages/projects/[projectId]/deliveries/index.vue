<template>
	<NuxtLayout name="project" :project-id="projectId">
		<section>
			<div class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Deliveries yet.</h2>
				<p class="m-0 mt-1 max-w-[680px] text-sz-helper leading-5 text-dim">
					Deliveries are created when an accepted Plan Output materializes executable work for this Project. Plan creation is not
					available in this slice.
				</p>
			</div>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const projectId = computed(() => route.params.projectId as string)
</script>
