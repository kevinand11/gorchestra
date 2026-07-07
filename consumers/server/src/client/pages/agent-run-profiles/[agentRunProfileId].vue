<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 pt-3 pb-4">
			<div class="min-w-0">
				<h1 class="m-0 truncate text-sz-section font-semibold tracking-[-0.01em]">
					{{ agentRunProfile?.name ?? 'Agent Run Profile' }}
				</h1>
				<p class="m-0 mt-1 text-sz-helper text-dim">Edit the Model Use Config and runtime setup that future Agent Runs snapshot.</p>
			</div>
		</header>

		<section v-if="isLoadingAgentRunProfile && !hasLoadedAgentRunProfile" class="border-b border-dimmer px-3 py-4 text-dim">
			Loading Agent Run Profile…
		</section>
		<section v-else-if="agentRunProfileError" class="border-b border-dimmer px-3 py-4 text-error">
			{{ agentRunProfileError }}
		</section>
		<section v-else-if="agentRunProfile" class="border-b border-dimmer">
			<AgentRunProfileForm
				class="py-3"
				:form="agentRunProfileForm"
				:model-select="modelSelect"
				:secret-options="secretOptions"
				:secret-options-loaded="hasLoadedSecrets"
				submit-label="Save Agent Run Profile"
				:loading="isUpdatingAgentRunProfile"
				:disabled="!agentRunProfileForm.valid || !agentRunProfileForm.dirty"
				:error="updateAgentRunProfileError"
				@submit="updateAgentRunProfile()" />
		</section>

		<template v-if="agentRunProfile" #right>
			<aside>
				<section class="border-b border-dimmer">
					<div class="px-3 py-3">
						<h2 class="m-0 text-sz-subsection font-semibold">Details</h2>
					</div>
					<dl class="m-0 text-sz-helper">
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<dt class="text-dim">Status</dt>
							<dd class="m-0" :class="agentRunProfile.archived ? 'text-dim' : 'text-success'">
								{{ agentRunProfile.archived ? 'Archived' : 'Active' }}
							</dd>
						</div>
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<dt class="text-dim">Created</dt>
							<dd class="m-0">{{ formatDate(agentRunProfile.created.at) }}</dd>
						</div>
						<div class="flex justify-between gap-3 border-t border-dimmer px-3 py-2">
							<dt class="text-dim">Updated</dt>
							<dd class="m-0">{{ updatedLabel }}</dd>
						</div>
					</dl>
					<p v-if="isRefreshingAgentRunProfile" class="m-0 border-t border-dimmer px-3 py-2 text-sz-helper text-dim">
						Refreshing Agent Run Profile…
					</p>
				</section>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Sandbox preflight</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Create a temporary sandbox from this profile, run a smoke check, and release it without changing saved profile
						state.
					</p>
					<div class="mt-3 grid gap-2">
						<UiButton
							type="button"
							variant="secondary"
							:loading="isPreflightingAgentRunProfile"
							@click="preflightAgentRunProfile()">
							Preflight Sandbox
						</UiButton>
						<UiCallout v-if="preflightEvidence" :tone="preflightEvidence.passed ? 'success' : 'error'">
							{{ preflightEvidence.summary }}
						</UiCallout>
						<UiText v-if="preflightAgentRunProfileError" tone="error">{{ preflightAgentRunProfileError }}</UiText>
					</div>
				</section>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Archive</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Archiving remains allowed with active references. Referencing configs may need a new selectable profile before work
						can run.
					</p>
					<div class="mt-3 grid gap-2">
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
							@click="requestAgentRunProfileArchive()">
							Archive Profile
						</UiButton>
						<UiText v-if="archiveAgentRunProfileError" tone="error">{{ archiveAgentRunProfileError }}</UiText>
						<UiText v-if="unarchiveAgentRunProfileError" tone="error">{{ unarchiveAgentRunProfileError }}</UiText>
					</div>
				</section>
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
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import AgentRunProfileForm from '../../components/portfolio/agent-run-profiles/AgentRunProfileForm.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiCallout from '../../components/ui/UiCallout.vue'
import UiText from '../../components/ui/UiText.vue'
import { useOverlay } from '../../composables/core/overlay'
import type { ServerApi } from '../../composables/core/server-api'
import {
	useAgentRunProfileArchiveActions,
	useAgentRunProfileDetail,
	useAgentRunProfilePreflight,
	useAgentRunProfileReferences,
	useAgentRunProfileUpdate,
} from '../../composables/portfolio/agent-run-profiles'
import { useSelectModel } from '../../composables/portfolio/models/select-model'
import { useActiveSecretSelectOptions } from '../../composables/portfolio/secrets'
import { formatDate } from '../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type AgentRunProfileReference = Awaited<ReturnType<ServerApi['listAgentRunProfileReferences']>>[number]

const route = useRoute()
const { confirm } = useOverlay()
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
const { preflightEvidence, isPreflightingAgentRunProfile, preflightAgentRunProfileError, preflightAgentRunProfile } =
	useAgentRunProfilePreflight(agentRunProfileId)
const modelSelect = useSelectModel(agentRunProfileForm.modelUse)
const { activeSecretOptions: secretOptions, hasLoadedSecrets } = useActiveSecretSelectOptions()
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

async function requestAgentRunProfileArchive(): Promise<void> {
	const profile = agentRunProfile.value
	if (profile === null) return
	const confirmed = await confirm({
		title: 'Archive Agent Run Profile?',
		body: 'Archiving remains allowed with active references. Referencing configs may need a new selectable profile before work can run.',
		confirm: { label: 'Archive Profile', tone: 'danger' },
	})
	if (!confirmed) return
	await archiveAgentRunProfile(profile)
}

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
