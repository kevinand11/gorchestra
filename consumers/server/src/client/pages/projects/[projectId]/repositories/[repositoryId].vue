<template>
	<NuxtLayout name="project" :project-id="projectId">
		<section>
			<div v-if="isLoadingRepositoryPage" class="border-b border-dimmer px-3 py-4 text-dim">Loading Repository…</div>
			<div v-else-if="repositoryPageError" class="border-b border-dimmer px-3 py-4 text-error">{{ repositoryPageError }}</div>
			<div v-else-if="repository" class="grid gap-0">
				<p v-if="isRefreshingRepositoryPage" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
					Refreshing Repository details…
				</p>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">{{ repository.config.owner }}/{{ repository.config.name }}</h2>
					<div class="mt-2 grid gap-2 text-sz-helper sm:grid-cols-2">
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Provider</span><span>{{ repository.config.provider }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Secret</span><span :class="secretToneClass">{{ secretLabel }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Created</span><span>{{ formatDate(repository.created.at) }}</span>
						</div>
					</div>
				</section>

				<section class="px-3 py-3">
					<div class="border border-dimmer bg-card p-3">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div>
								<h2 class="m-0 text-sz-subsection font-semibold">Repository Preflight</h2>
								<p class="m-0 mt-1 text-sz-helper text-dim">
									Check whether Core can currently resolve and use this GitHub Repository configuration.
								</p>
							</div>
							<UiButton :loading="isPreflightingRepository" @click="preflightRepository()">Run Preflight</UiButton>
						</div>
						<UiText v-if="preflightRepositoryError" class="mt-3" tone="error">{{ preflightRepositoryError }}</UiText>
						<div v-if="preflightEvidence" class="mt-3 border border-dimmer bg-canvas p-3">
							<p class="m-0 font-semibold" :class="preflightEvidence.passed ? 'text-success' : 'text-error'">
								{{ preflightEvidence.passed ? 'Preflight passed.' : 'Preflight failed.' }}
							</p>
							<p class="m-0 mt-1 text-sz-helper text-dim">{{ preflightEvidence.summary }}</p>
						</div>
					</div>
				</section>
			</div>
		</section>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import UiButton from '../../../../components/ui/UiButton.vue'
import UiText from '../../../../components/ui/UiText.vue'
import { useRepositoryDetail, useRepositoryPreflight } from '../../../../composables/portfolio/project/repositories'
import { useSecretsList } from '../../../../composables/portfolio/secrets'
import { formatDate } from '../../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const projectId = computed(() => route.params.projectId as string)
const repositoryId = computed(() => route.params.repositoryId as string)
const { repository, isLoadingRepository, repositoryError, hasLoadedRepository, isRefreshingRepository } = useRepositoryDetail(
	projectId,
	repositoryId,
)
const { secrets, isLoadingSecrets, secretsError, hasLoadedSecrets, isRefreshingSecrets } = useSecretsList()
const { preflightEvidence, isPreflightingRepository, preflightRepositoryError, preflightRepository } = useRepositoryPreflight(
	projectId,
	repositoryId,
)

const referencedSecret = computed(() => {
	const secretId = repository.value?.config.secretId
	if (!secretId) return undefined
	return secrets.value.find((secret) => secret.id === secretId)
})
const secretLabel = computed(() => {
	const secret = referencedSecret.value
	if (secret === undefined) return 'not found'
	return secret.archived ? `${secret.name} — archived` : secret.name
})
const secretToneClass = computed(() => {
	const secret = referencedSecret.value
	return !secret || secret.archived ? 'text-error' : 'text-success'
})
const isLoadingRepositoryPage = computed(
	() => (isLoadingRepository.value && !hasLoadedRepository.value) || (isLoadingSecrets.value && !hasLoadedSecrets.value),
)
const repositoryPageError = computed(() => repositoryError.value || secretsError.value)
const isRefreshingRepositoryPage = computed(() => isRefreshingRepository.value || isRefreshingSecrets.value)
</script>
