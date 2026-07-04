<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 pt-3 pb-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Agent Run Profiles</h1>
					<p class="m-0 mt-1 text-sz-helper text-dim">Create reusable Model and thinking selections for future Agent Runs.</p>
				</div>
				<button
					class="border border-primary bg-primary px-3 py-1.5 text-sz-helper font-semibold text-primary-contrast hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
					:disabled="!agentRunProfileForm.valid || isCreatingAgentRunProfile"
					@click="createAgentRunProfile()">
					Create profile
				</button>
			</div>
		</header>

		<section class="border-b border-dimmer">
			<div class="px-3 py-3">
				<h2 class="m-0 text-sz-subsection font-semibold">New profile</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">Profiles snapshot onto Agent Runs when the run is created.</p>
			</div>
			<div v-if="createAgentRunProfileError" class="border-t border-dimmer px-3 py-2 text-sz-helper text-error">
				{{ createAgentRunProfileError }}
			</div>
			<div class="grid gap-3 border-t border-dimmer px-3 py-3 md:grid-cols-3">
				<UiFormGroup label="Name" for-id="agent-run-profile-name" :error="agentRunProfileForm.errors.name">
					<UiInput id="agent-run-profile-name" v-model="agentRunProfileForm.name" :invalid="!!agentRunProfileForm.errors.name" />
				</UiFormGroup>
				<UiFormGroup label="Model" for-id="agent-run-profile-model" :error="agentRunProfileForm.modelUse.errors.modelId">
					<UiSelect
						id="agent-run-profile-model"
						v-model="agentRunProfileForm.modelUse.modelId.value"
						:options="modelSelect.modelOptions.value"
						placeholder="Select Model"
						:invalid="!!agentRunProfileForm.modelUse.errors.modelId" />
				</UiFormGroup>
				<UiFormGroup
					label="Thinking"
					for-id="agent-run-profile-thinking"
					:error="agentRunProfileForm.modelUse.errors.thinkingLevel">
					<UiSelect
						id="agent-run-profile-thinking"
						v-model="agentRunProfileForm.modelUse.thinkingLevel.value"
						:options="modelSelect.thinkingLevelOptions.value"
						placeholder="Select thinking"
						:invalid="!!agentRunProfileForm.modelUse.errors.thinkingLevel" />
				</UiFormGroup>
			</div>
		</section>

		<section>
			<div v-if="isLoadingAgentRunProfiles && !hasLoadedAgentRunProfiles" class="border-b border-dimmer px-3 py-4 text-dim">
				Loading Agent Run Profiles…
			</div>
			<div v-else-if="agentRunProfilesError" class="border-b border-dimmer px-3 py-4 text-error">{{ agentRunProfilesError }}</div>
			<div v-else-if="agentRunProfiles.length === 0" class="m-3 border border-dashed border-dimmer p-5">
				<h2 class="m-0 text-sz-subsection font-semibold">No Agent Run Profiles yet.</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">Create a profile before creating Projects or Plans.</p>
			</div>
			<div v-else>
				<div
					v-for="profile in agentRunProfiles"
					:key="profile.id"
					class="grid min-h-[52px] grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 border-b border-dimmer px-3 py-2"
					:class="profile.archived ? 'opacity-50' : ''">
					<span class="grid size-5 place-items-center border border-dimmer text-sz-micro text-dim">A</span>
					<span class="min-w-0">
						<strong class="block truncate font-semibold">{{ profile.name }}</strong>
						<span class="text-sz-helper text-dim">
							{{ profile.archived ? 'Archived · ' : '' }}Model {{ profile.modelUse.modelId }} ·
							{{ profile.modelUse.thinkingLevel }}
						</span>
					</span>
					<button
						class="border border-dimmer px-2 py-1 text-sz-helper hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
						:disabled="isArchivingAgentRunProfile || isUnarchivingAgentRunProfile"
						@click="profile.archived ? unarchiveAgentRunProfile(profile) : archiveAgentRunProfile(profile)">
						{{ profile.archived ? 'Unarchive' : 'Archive' }}
					</button>
				</div>
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
import UiFormGroup from '../../components/ui/UiFormGroup.vue'
import UiInput from '../../components/ui/UiInput.vue'
import UiSelect from '../../components/ui/UiSelect.vue'
import {
	useAgentRunProfileArchiveActions,
	useAgentRunProfileCreate,
	useAgentRunProfilesList,
} from '../../composables/portfolio/agent-run-profiles'
import { useSelectModel } from '../../composables/portfolio/models/select-model'

definePageMeta({ middleware: ['has-selection'] })

const { agentRunProfiles, isLoadingAgentRunProfiles, agentRunProfilesError, hasLoadedAgentRunProfiles, isRefreshingAgentRunProfiles } =
	useAgentRunProfilesList()
const { agentRunProfileForm, isCreatingAgentRunProfile, createAgentRunProfileError, createAgentRunProfile } = useAgentRunProfileCreate()
const modelSelect = useSelectModel(agentRunProfileForm.modelUse)
const { isArchivingAgentRunProfile, archiveAgentRunProfile, isUnarchivingAgentRunProfile, unarchiveAgentRunProfile } =
	useAgentRunProfileArchiveActions()
</script>
