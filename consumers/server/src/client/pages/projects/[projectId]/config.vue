<template>
	<NuxtLayout name="project" :project-id="projectId">
		<header class="border-b border-dimmer px-3 pt-3 pb-4">
			<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Project Config</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Set required Delivery work defaults for this Project.</p>
		</header>

		<section v-if="isLoadingProjectConfig && !hasLoadedProjectConfig" class="border-b border-dimmer px-3 py-4 text-dim">
			Loading Project Config…
		</section>
		<section v-else-if="projectConfigError" class="border-b border-dimmer px-3 py-4 text-error">{{ projectConfigError }}</section>
		<section v-else class="px-3 py-3">
			<UiForm @submit.prevent="saveProjectConfig()">
				<div class="grid gap-3 md:grid-cols-2">
					<UiFormGroup
						label="Execution Agent Run Profile"
						for-id="execution-profile"
						:error="projectConfigForm.errors.executionAgentRunProfileId">
						<UiSelect
							id="execution-profile"
							v-model="projectConfigForm.executionAgentRunProfileId"
							:options="activeAgentRunProfileOptions"
							:invalid="!!projectConfigForm.errors.executionAgentRunProfileId" />
					</UiFormGroup>
					<UiFormGroup
						label="Revision execution profile"
						for-id="revision-execution-profile"
						:error="projectConfigForm.errors.revisionExecutionAgentRunProfileId">
						<UiSelect
							id="revision-execution-profile"
							v-model="projectConfigForm.revisionExecutionAgentRunProfileId"
							:options="[{ value: null, label: 'Use execution profile' }, ...activeAgentRunProfileOptions]"
							:invalid="!!projectConfigForm.errors.revisionExecutionAgentRunProfileId" />
					</UiFormGroup>
					<UiFormGroup
						label="Max processable Slice slots"
						for-id="slice-slots"
						:error="projectConfigForm.errors.maxProcessableSliceSlots">
						<UiInput id="slice-slots" v-model.number="projectConfigForm.maxProcessableSliceSlots" type="number" min="1" />
					</UiFormGroup>
					<UiFormGroup
						label="Max correction retries"
						for-id="correction-retries"
						:error="projectConfigForm.errors.maxCorrectionRetriesPerFailure">
						<UiInput
							id="correction-retries"
							v-model.number="projectConfigForm.maxCorrectionRetriesPerFailure"
							type="number"
							min="0" />
					</UiFormGroup>
				</div>
				<div class="mt-3 flex flex-wrap items-center gap-2">
					<UiButton
						type="submit"
						:loading="isSavingProjectConfig"
						:disabled="!projectConfigForm.valid || !projectConfigForm.dirty">
						Save Project Config
					</UiButton>
					<UiText v-if="saveProjectConfigError" tone="error">{{ saveProjectConfigError }}</UiText>
				</div>
			</UiForm>
		</section>

		<template #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Required defaults</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Every Project stores Delivery work defaults. Delivery-specific config replaces this whole work config when present.
					</p>
				</section>
				<section class="px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Revision execution</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Leave revision execution blank to reuse the execution profile for correction work.
					</p>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import UiButton from '../../../components/ui/UiButton.vue'
import UiForm from '../../../components/ui/UiForm.vue'
import UiFormGroup from '../../../components/ui/UiFormGroup.vue'
import UiInput from '../../../components/ui/UiInput.vue'
import UiSelect from '../../../components/ui/UiSelect.vue'
import UiText from '../../../components/ui/UiText.vue'
import { useProjectConfig } from '../../../composables/portfolio/project/config'

definePageMeta({ middleware: ['has-selection'] })

const route = useRoute()
const projectId = computed(() => String(route.params.projectId ?? ''))
const {
	projectConfigForm,
	activeAgentRunProfileOptions,
	isLoadingProjectConfig,
	projectConfigError,
	hasLoadedProjectConfig,
	isSavingProjectConfig,
	saveProjectConfigError,
	saveProjectConfig,
} = useProjectConfig(projectId)
</script>
