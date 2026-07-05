<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 pt-3 pb-4">
			<div class="min-w-0">
				<NuxtLink to="/agent-run-profiles" class="text-sz-helper text-dim hover:text-body">← Agent Run Profiles</NuxtLink>
				<h1 class="m-0 mt-1 text-sz-section font-semibold tracking-[-0.01em]">New Agent Run Profile</h1>
				<p class="m-0 mt-1 text-sz-helper text-dim">Create reusable Model Use and sandbox runtime setup for future Agent Runs.</p>
			</div>
		</header>

		<section class="border-b border-dimmer">
			<div class="px-3 py-3">
				<h2 class="m-0 text-sz-subsection font-semibold">Profile details</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">
					Profiles snapshot onto Agent Runs when the run is created. Later profile edits affect future runs only.
				</p>
			</div>
			<AgentRunProfileForm
				class="border-t border-dimmer px-3 py-3"
				:form="agentRunProfileForm"
				:model-select="modelSelect"
				:secret-options="secretOptions"
				:secret-options-loaded="hasLoadedSecrets"
				submit-label="Create Agent Run Profile"
				:loading="isCreatingAgentRunProfile"
				:disabled="!agentRunProfileForm.valid || isCreatingAgentRunProfile"
				:error="createAgentRunProfileError"
				@submit="createAgentRunProfile()" />
		</section>

		<template #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Run creation</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Plans, Revision Gates, and Delivery execution select a profile directly. The selected profile is copied onto each
						new Agent Run.
					</p>
				</section>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Model use</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Model and thinking level are stored together so Core never represents a half-selected model configuration.
					</p>
				</section>
				<section class="px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Runtime setup</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Environment Secret Requirements persist values in the Agent Run sandbox. Run Command Requirements execute structured
						argv without shell chaining, pipes, redirects, or implicit <code>cd</code>.
					</p>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import AgentRunProfileForm from '../../components/portfolio/agent-run-profiles/AgentRunProfileForm.vue'
import { useAgentRunProfileCreate } from '../../composables/portfolio/agent-run-profiles'
import { useSelectModel } from '../../composables/portfolio/models/select-model'
import { useActiveSecretSelectOptions } from '../../composables/portfolio/secrets'

definePageMeta({ middleware: ['has-selection'] })

const { agentRunProfileForm, isCreatingAgentRunProfile, createAgentRunProfileError, createAgentRunProfile } = useAgentRunProfileCreate({
	onSuccess: async (profile) => {
		await navigateTo(`/agent-run-profiles/${profile.id}`)
	},
})
const modelSelect = useSelectModel(agentRunProfileForm.modelUse)
const { activeSecretOptions: secretOptions, hasLoadedSecrets } = useActiveSecretSelectOptions()
</script>
