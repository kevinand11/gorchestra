<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 pt-3 pb-4">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div class="min-w-0">
					<NuxtLink to="/agent-run-profiles" class="text-sz-helper text-dim hover:text-body">← Agent Run Profiles</NuxtLink>
					<h1 class="m-0 mt-1 truncate text-sz-section font-semibold tracking-[-0.01em]">
						{{ agentRunProfile?.name ?? 'Agent Run Profile' }}
					</h1>
					<p class="m-0 mt-1 text-sz-helper text-dim">
						Edit the Model Use Config and runtime setup that future Agent Runs snapshot.
					</p>
				</div>
				<div v-if="agentRunProfile" class="flex flex-wrap items-center gap-2">
					<UiButton
						v-if="agentRunProfile.archived"
						type="button"
						variant="secondary"
						:loading="isUnarchivingAgentRunProfile"
						@click="unarchiveAgentRunProfile(agentRunProfile)">
						Unarchive Profile
					</UiButton>
					<UiButton
						v-else
						type="button"
						variant="ghost"
						:loading="isArchivingAgentRunProfile"
						@click="archiveAgentRunProfile(agentRunProfile)">
						Archive Profile
					</UiButton>
				</div>
			</div>
		</header>

		<section v-if="isLoadingAgentRunProfile && !hasLoadedAgentRunProfile" class="border-b border-dimmer px-3 py-4 text-dim">
			Loading Agent Run Profile…
		</section>
		<section v-else-if="agentRunProfileError" class="border-b border-dimmer px-3 py-4 text-error">
			{{ agentRunProfileError }}
		</section>
		<section v-else-if="agentRunProfile" class="border-b border-dimmer">
			<div class="px-3 py-3">
				<h2 class="m-0 text-sz-subsection font-semibold">Profile details</h2>
				<p class="m-0 mt-1 text-sz-helper text-dim">
					Profile edits affect future Agent Runs only. Existing Agent Runs keep their profile snapshot.
				</p>
			</div>
			<div class="grid gap-3 border-t border-dimmer px-3 py-3 md:grid-cols-3">
				<div>
					<span class="block text-sz-micro font-semibold uppercase tracking-wide text-dim">Status</span>
					<strong class="mt-1 block text-sz-helper font-semibold">{{ agentRunProfile.archived ? 'Archived' : 'Active' }}</strong>
				</div>
				<div>
					<span class="block text-sz-micro font-semibold uppercase tracking-wide text-dim">Created</span>
					<strong class="mt-1 block text-sz-helper font-semibold">{{ formatDate(agentRunProfile.created.at) }}</strong>
				</div>
				<div>
					<span class="block text-sz-micro font-semibold uppercase tracking-wide text-dim">Updated</span>
					<strong class="mt-1 block text-sz-helper font-semibold">{{ updatedLabel }}</strong>
				</div>
			</div>
			<AgentRunProfileForm
				class="border-t border-dimmer px-3 py-3"
				:form="agentRunProfileForm"
				:model-select="modelSelect"
				submit-label="Save Agent Run Profile"
				:loading="isUpdatingAgentRunProfile"
				:disabled="!agentRunProfileForm.valid || !agentRunProfileForm.dirty"
				:error="updateAgentRunProfileError"
				@submit="updateAgentRunProfile()" />
			<div
				v-if="archiveAgentRunProfileError || unarchiveAgentRunProfileError"
				class="border-t border-dimmer px-3 py-2 text-sz-helper">
				<UiText v-if="archiveAgentRunProfileError" tone="error">{{ archiveAgentRunProfileError }}</UiText>
				<UiText v-if="unarchiveAgentRunProfileError" tone="error">{{ unarchiveAgentRunProfileError }}</UiText>
			</div>
			<p v-if="isRefreshingAgentRunProfile" class="m-0 border-t border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Agent Run Profile…
			</p>
		</section>

		<template v-if="agentRunProfile" #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">References</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Direct config references show Project and Delivery work settings that can use this profile for future Agent Runs.
						Historical Agent Run snapshots are not included.
					</p>
				</section>
				<section>
					<div
						v-if="isLoadingAgentRunProfileReferences && !hasLoadedAgentRunProfileReferences"
						class="border-b border-dimmer px-3 py-3 text-sz-helper text-dim">
						Loading references…
					</div>
					<div v-else-if="agentRunProfileReferencesError" class="border-b border-dimmer px-3 py-3 text-sz-helper text-error">
						{{ agentRunProfileReferencesError }}
					</div>
					<div
						v-else-if="agentRunProfileReferences.length === 0"
						class="border-b border-dimmer px-3 py-3 text-sz-helper text-dim">
						No direct config references for this Agent Run Profile.
					</div>
					<div v-else>
						<NuxtLink
							v-for="reference in agentRunProfileReferences"
							:key="referenceKey(reference)"
							:to="referenceLocation(reference)"
							class="block border-b border-dimmer px-3 py-2 text-body hover:bg-card focus-visible:bg-secondary"
							:class="reference.active ? '' : 'opacity-50'">
							<strong class="block truncate text-sz-helper font-semibold">{{ referenceTitle(reference) }}</strong>
							<span class="mt-1 block truncate text-sz-micro text-dim">{{ referenceSubtitle(reference) }}</span>
						</NuxtLink>
					</div>
					<p v-if="isRefreshingAgentRunProfileReferences" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
						Refreshing references…
					</p>
				</section>
				<section class="border-t border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Runtime setup</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Runtime Requirement changes affect future Agent Runs only. Existing Agent Runs keep their profile snapshot and may
						receive runtime requirement overrides directly.
					</p>
				</section>
				<section class="px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Archiving impact</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Archiving remains allowed with active references. Referencing configs may need a new selectable profile before work
						can run.
					</p>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import AgentRunProfileForm from '../../components/portfolio/agent-run-profiles/AgentRunProfileForm.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiText from '../../components/ui/UiText.vue'
import type { ServerApi } from '../../composables/core/server-api'
import {
	useAgentRunProfileArchiveActions,
	useAgentRunProfileDetail,
	useAgentRunProfileReferences,
	useAgentRunProfileUpdate,
} from '../../composables/portfolio/agent-run-profiles'
import { useSelectModel } from '../../composables/portfolio/models/select-model'
import { formatDate } from '../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type AgentRunProfileReference = Awaited<ReturnType<ServerApi['listAgentRunProfileReferences']>>[number]

const route = useRoute()
const agentRunProfileId = computed(() => String(route.params.agentRunProfileId ?? ''))
const { agentRunProfile, isLoadingAgentRunProfile, agentRunProfileError, hasLoadedAgentRunProfile, isRefreshingAgentRunProfile } =
	useAgentRunProfileDetail(agentRunProfileId)
const {
	agentRunProfileReferences,
	isLoadingAgentRunProfileReferences,
	agentRunProfileReferencesError,
	hasLoadedAgentRunProfileReferences,
	isRefreshingAgentRunProfileReferences,
} = useAgentRunProfileReferences(agentRunProfileId)
const { agentRunProfileForm, isUpdatingAgentRunProfile, updateAgentRunProfileError, updateAgentRunProfile } =
	useAgentRunProfileUpdate(agentRunProfileId)
const modelSelect = useSelectModel(agentRunProfileForm.modelUse)
const {
	isArchivingAgentRunProfile,
	archiveAgentRunProfileError,
	archiveAgentRunProfile,
	isUnarchivingAgentRunProfile,
	unarchiveAgentRunProfileError,
	unarchiveAgentRunProfile,
} = useAgentRunProfileArchiveActions()
const updatedLabel = computed(() => {
	const profile = agentRunProfile.value
	return profile === null || profile.updated === null ? 'Never' : formatDate(profile.updated.at)
})

watch(
	() => agentRunProfile.value,
	(profile) => {
		if (profile !== null) agentRunProfileForm.loadEntity(profile)
	},
	{ immediate: true },
)

function referenceLocation(reference: AgentRunProfileReference): string {
	switch (reference.type) {
		case 'project-config':
			return `/projects/${reference.projectId}/config`
		case 'delivery-config':
			return `/projects/${reference.projectId}/deliveries/${reference.deliveryId}`
		default:
			throw new Error(`Unexpected Agent Run Profile Reference type: ${String(reference satisfies never)}`)
	}
}

function referenceTitle(reference: AgentRunProfileReference): string {
	switch (reference.type) {
		case 'project-config':
			return reference.projectTitle
		case 'delivery-config':
			return reference.deliveryTitle
		default:
			throw new Error(`Unexpected Agent Run Profile Reference type: ${String(reference satisfies never)}`)
	}
}

function referenceSubtitle(reference: AgentRunProfileReference): string {
	switch (reference.type) {
		case 'project-config':
			return `Project Config · ${roleLabel(reference.role)}`
		case 'delivery-config':
			return `Delivery Config · ${roleLabel(reference.role)}${reference.active ? '' : ' · Closed'}`
		default:
			throw new Error(`Unexpected Agent Run Profile Reference type: ${String(reference satisfies never)}`)
	}
}

function referenceKey(reference: AgentRunProfileReference): string {
	switch (reference.type) {
		case 'project-config':
			return `${reference.type}:${reference.projectId}:${reference.role}`
		case 'delivery-config':
			return `${reference.type}:${reference.deliveryId}:${reference.role}`
		default:
			throw new Error(`Unexpected Agent Run Profile Reference type: ${String(reference satisfies never)}`)
	}
}

function roleLabel(role: AgentRunProfileReference['role']): string {
	switch (role) {
		case 'execution':
			return 'Execution'
		case 'revision-execution':
			return 'Revision execution'
		default:
			throw new Error(`Unexpected Agent Run Profile Reference role: ${String(role satisfies never)}`)
	}
}
</script>
