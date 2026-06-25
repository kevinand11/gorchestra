<template>
	<NuxtLayout name="brain" title="Brain Graph" subtitle="Explore Portfolio Memories and their Links as a navigable map.">
		<section class="m-3 border border-dashed border-dimmer p-5">
			<h2 class="m-0 text-sz-subsection font-semibold">Graph view is not available yet.</h2>
			<p class="m-0 mt-1 max-w-[680px] text-sz-helper leading-5 text-dim">
				The Brain Graph will show Portfolio Memories and their Links as a navigable map. Use the Memory Ledger to search and inspect
				Memories for now.
			</p>
			<NuxtLink
				class="mt-4 inline-flex border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast no-underline"
				to="/brain/memories">
				Open Memory Ledger
			</NuxtLink>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['has-selection'] })
</script>
