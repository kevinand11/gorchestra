<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 pt-3 pb-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Agent Run Profiles</h1>
					<p class="m-0 mt-1 text-sz-helper text-dim">Create and inspect reusable run settings for future Agent Runs.</p>
				</div>
				<NuxtLink
					class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast hover:brightness-110"
					to="/agent-run-profiles/new">
					New profile
				</NuxtLink>
			</div>
		</header>

		<section>
			<div v-if="isLoadingAgentRunProfiles && !hasLoadedAgentRunProfiles" class="border-b border-dimmer px-3 py-4 text-dim">
				Loading Agent Run Profiles…
			</div>
			<div v-else-if="agentRunProfilesError" class="border-b border-dimmer px-3 py-4 text-error">{{ agentRunProfilesError }}</div>
			<div v-else-if="agentRunProfiles.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Agent Run Profiles yet.</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">Create a profile before creating Projects or Plans.</p>
				<NuxtLink
					class="mt-4 inline-flex border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast"
					to="/agent-run-profiles/new">
					Create your first profile
				</NuxtLink>
			</div>
			<div v-else>
				<NuxtLink
					v-for="profile in agentRunProfiles"
					:key="profile.id"
					:to="`/agent-run-profiles/${profile.id}`"
					class="grid min-h-[52px] grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-b border-dimmer px-3 py-2 text-body hover:bg-card focus-visible:bg-secondary"
					:class="profile.archived ? 'opacity-50' : ''">
					<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">A</span>
					<span class="min-w-0">
						<strong class="block truncate font-semibold">{{ profile.name }}</strong>
						<span class="text-sz-helper text-dim">
							{{ profile.archived ? 'Archived · ' : '' }}Model {{ profile.modelUse.modelId }} ·
							{{ profile.modelUse.thinkingLevel }}
						</span>
					</span>
				</NuxtLink>
			</div>
			<p v-if="isRefreshingAgentRunProfiles" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Agent Run Profiles…
			</p>
		</section>

		<template #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Run creation</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Plans, Revision Gates, and Delivery execution select a profile directly. Later profile edits affect future runs
						only.
					</p>
				</section>
				<section class="px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Run overrides</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Interactive Agent Runs may still switch model use mid-run without changing their selected profile.
					</p>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { useAgentRunProfilesList } from '../../composables/portfolio/agent-run-profiles'

definePageMeta({ middleware: ['has-selection'] })

const { agentRunProfiles, isLoadingAgentRunProfiles, agentRunProfilesError, hasLoadedAgentRunProfiles, isRefreshingAgentRunProfiles } =
	useAgentRunProfilesList()
</script>
