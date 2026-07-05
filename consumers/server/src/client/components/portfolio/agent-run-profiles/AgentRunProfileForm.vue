<template>
	<UiForm @submit.prevent="emit('submit')">
		<div class="grid gap-3 md:grid-cols-3">
			<UiFormGroup label="Name" for-id="agent-run-profile-name" :error="form.errors.name">
				<UiInput id="agent-run-profile-name" v-model="form.name" :invalid="!!form.errors.name" />
			</UiFormGroup>
			<UiFormGroup label="Model" for-id="agent-run-profile-model" :error="form.modelUse.errors.modelId">
				<UiSelect
					id="agent-run-profile-model"
					v-model="form.modelUse.modelId.value"
					:options="modelSelect.modelOptions.value"
					placeholder="Select Model"
					:invalid="!!form.modelUse.errors.modelId" />
			</UiFormGroup>
			<UiFormGroup label="Thinking" for-id="agent-run-profile-thinking" :error="form.modelUse.errors.thinkingLevel">
				<UiSelect
					id="agent-run-profile-thinking"
					v-model="form.modelUse.thinkingLevel.value"
					:options="modelSelect.thinkingLevelOptions.value"
					placeholder="Select thinking"
					:invalid="!!form.modelUse.errors.thinkingLevel" />
			</UiFormGroup>
		</div>

		<section class="mt-6 border-t border-card-border pt-4">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<UiText class="font-semibold">Runtime Requirements</UiText>
					<UiText tone="muted" size="helper">
						Apply ordered sandbox setup before Agent Run model turns. Use structured argv; shell syntax is not interpreted.
					</UiText>
				</div>
				<div class="flex flex-wrap gap-2">
					<UiButton type="button" variant="secondary" @click="addEnvironmentSecretRequirement">Add environment Secret</UiButton>
					<UiButton type="button" variant="secondary" @click="addRunCommandRequirement">Add Run Command</UiButton>
				</div>
			</div>

			<div class="mt-3 space-y-2 text-sm text-body-muted">
				<p>
					<strong>Chaining:</strong> use multiple ordered Run Command Requirements instead of <code>cmd1 &amp;&amp; cmd2</code>.
				</p>
				<p>
					<strong><code>cd</code>:</strong> set <code>cwd</code>, for example <code>/workspace/repos/&lt;repository-id&gt;</code>.
				</p>
				<p>
					<strong>Pipes:</strong> prefer direct argv alternatives such as <code>grep hello a.txt</code>; <code>|</code> is not
					interpreted in v1.
				</p>
				<p v-if="secretOptionsLoaded && secretOptions.length === 0">
					Create Secrets first before selecting environment or command-scoped Secrets.
				</p>
			</div>

			<div v-if="form.runtimeRequirements.length === 0" class="mt-4 border-t border-card-border py-4">
				<UiText tone="muted">No runtime requirements. This profile will use only source checkout preparation.</UiText>
			</div>

			<div v-for="(requirement, index) in form.runtimeRequirements" :key="index" class="mt-4 border-t border-card-border pt-4">
				<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
					<UiText class="font-medium">Requirement {{ index + 1 }}</UiText>
					<UiButton type="button" variant="secondary" @click="form.runtimeRequirements.delete(index)">Remove</UiButton>
				</div>

				<div class="grid gap-3 md:grid-cols-3">
					<UiFormGroup label="Type" :for-id="`runtime-requirement-${index}-type`" :error="requirement.errors.type">
						<UiSelect
							:id="`runtime-requirement-${index}-type`"
							v-model="requirement.type"
							:options="runtimeRequirementTypeOptions"
							placeholder="Select requirement type"
							:invalid="!!requirement.errors.type" />
					</UiFormGroup>

					<template v-if="requirement.type === 'environment-secret'">
						<UiFormGroup
							label="Environment name"
							:for-id="`runtime-requirement-${index}-env-name`"
							:error="requirement.errors.envName">
							<UiInput
								:id="`runtime-requirement-${index}-env-name`"
								v-model="requirement.envName"
								placeholder="NPM_TOKEN"
								:invalid="!!requirement.errors.envName" />
						</UiFormGroup>
						<UiFormGroup
							label="Secret"
							:for-id="`runtime-requirement-${index}-secret-id`"
							:error="requirement.secretId.errors.value">
							<UiSelect
								:id="`runtime-requirement-${index}-secret-id`"
								v-model="requirement.secretId.value"
								:options="secretOptions"
								placeholder="Select Secret"
								:invalid="!!requirement.secretId.errors.value" />
						</UiFormGroup>
					</template>

					<template v-else>
						<UiFormGroup label="Label" :for-id="`runtime-requirement-${index}-label`" :error="requirement.errors.label">
							<UiInput
								:id="`runtime-requirement-${index}-label`"
								v-model="requirement.label"
								placeholder="Install dependencies"
								:invalid="!!requirement.errors.label" />
						</UiFormGroup>
						<UiFormGroup
							label="Executable"
							:for-id="`runtime-requirement-${index}-executable`"
							:error="requirement.errors.executable">
							<UiInput
								:id="`runtime-requirement-${index}-executable`"
								v-model="requirement.executable"
								placeholder="pnpm"
								:invalid="!!requirement.errors.executable" />
						</UiFormGroup>
						<UiFormGroup label="cwd" :for-id="`runtime-requirement-${index}-cwd`" :error="requirement.errors.cwdText">
							<UiInput
								:id="`runtime-requirement-${index}-cwd`"
								v-model="requirement.cwdText"
								placeholder="/workspace/repos/repository-id"
								:invalid="!!requirement.errors.cwdText" />
						</UiFormGroup>
						<div class="md:col-span-3">
							<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
								<div>
									<UiText class="font-medium">Args</UiText>
									<UiText tone="muted" size="helper"
										>One row per argv entry. Blank rows are sent as empty-string args.</UiText
									>
								</div>
								<UiButton type="button" variant="secondary" @click="requirement.args.add()">Add arg</UiButton>
							</div>
							<div v-if="[...requirement.args].length === 0">
								<UiText tone="muted" size="helper">No args.</UiText>
							</div>
							<div
								v-for="(arg, argIndex) in [...requirement.args]"
								:key="argIndex"
								class="grid gap-3 py-2 md:grid-cols-[1fr_auto]">
								<UiFormGroup
									:label="`Arg ${argIndex + 1}`"
									:for-id="`runtime-requirement-${index}-arg-${argIndex}`"
									:error="arg.errors.value">
									<UiInput
										:id="`runtime-requirement-${index}-arg-${argIndex}`"
										v-model="arg.value"
										placeholder="--frozen-lockfile"
										:invalid="!!arg.errors.value" />
								</UiFormGroup>
								<div class="flex items-end">
									<UiButton type="button" variant="secondary" @click="requirement.args.delete(argIndex)">Remove</UiButton>
								</div>
							</div>
						</div>
					</template>
				</div>

				<div v-if="requirement.type === 'run-command'" class="mt-4 border-t border-card-border pt-3">
					<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
						<UiText class="font-medium">Command-scoped Secrets</UiText>
						<UiButton type="button" variant="secondary" @click="addCommandSecret(requirement)">Add command Secret</UiButton>
					</div>
					<div v-if="[...requirement.commandSecretEnv].length === 0">
						<UiText tone="muted" size="helper">No command-scoped Secrets.</UiText>
					</div>
					<div
						v-for="(secretEnv, secretIndex) in [...requirement.commandSecretEnv]"
						:key="secretIndex"
						class="grid gap-3 py-2 md:grid-cols-[1fr_1fr_auto]">
						<UiFormGroup
							label="Env name"
							:for-id="`runtime-requirement-${index}-command-secret-${secretIndex}-env`"
							:error="secretEnv.errors.envName">
							<UiInput
								:id="`runtime-requirement-${index}-command-secret-${secretIndex}-env`"
								v-model="secretEnv.envName"
								placeholder="NPM_TOKEN"
								:invalid="!!secretEnv.errors.envName" />
						</UiFormGroup>
						<UiFormGroup
							label="Secret"
							:for-id="`runtime-requirement-${index}-command-secret-${secretIndex}-secret`"
							:error="secretEnv.secretId.errors.value">
							<UiSelect
								:id="`runtime-requirement-${index}-command-secret-${secretIndex}-secret`"
								v-model="secretEnv.secretId.value"
								:options="secretOptions"
								placeholder="Select Secret"
								:invalid="!!secretEnv.secretId.errors.value" />
						</UiFormGroup>
						<div class="flex items-end">
							<UiButton type="button" variant="secondary" @click="requirement.commandSecretEnv.delete(secretIndex)"
								>Remove</UiButton
							>
						</div>
					</div>
				</div>
			</div>
		</section>

		<div class="mt-4 flex flex-wrap items-center gap-2 border-t border-card-border pt-4">
			<UiButton type="submit" :loading="loading" :disabled="disabled">{{ submitLabel }}</UiButton>
			<UiText v-if="error" tone="error">{{ error }}</UiText>
		</div>
	</UiForm>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import UiButton from '../../ui/UiButton.vue'
import UiForm from '../../ui/UiForm.vue'
import UiFormGroup from '../../ui/UiFormGroup.vue'
import UiInput from '../../ui/UiInput.vue'
import UiSelect from '../../ui/UiSelect.vue'
import UiText from '../../ui/UiText.vue'
import type { UiSelectOptionInput } from '../../ui/select-options'
import type { useSelectModel } from '../../../composables/portfolio/models/select-model'
import type { AgentRunProfileFormDraft } from '../../../forms/agent-run-profile'
import type { RuntimeRequirementFormDraft } from '../../../forms/agent-run-runtime-requirements'

const props = defineProps<{
	form: AgentRunProfileFormDraft
	modelSelect: ReturnType<typeof useSelectModel>
	secretOptions: readonly UiSelectOptionInput<string>[]
	secretOptionsLoaded: boolean
	submitLabel: string
	loading: boolean
	disabled: boolean
	error: string
}>()

const emit = defineEmits<{ submit: [] }>()

const runtimeRequirementTypeOptions = [
	{ value: 'environment-secret', label: 'Environment Secret' },
	{ value: 'run-command', label: 'Run Command' },
]
const secretOptionValues = computed(() => selectOptionValues(props.secretOptions))

watch(
	() => [props.secretOptionsLoaded, props.secretOptions] as const,
	() => syncFormSecretOptions(),
	{ immediate: true },
)

function addEnvironmentSecretRequirement(): void {
	const requirement = props.form.runtimeRequirements.add()
	requirement.type = 'environment-secret'
	syncRequirementSecretOptions(requirement)
}

function addRunCommandRequirement(): void {
	const requirement = props.form.runtimeRequirements.add().loadEntity({
		type: 'run-command',
		label: '',
		command: { executable: '', args: [], cwd: null },
		commandSecretEnv: {},
	})
	syncRequirementSecretOptions(requirement)
}

function addCommandSecret(requirement: RuntimeRequirementFormDraft): void {
	const commandSecret = requirement.commandSecretEnv.add()
	if (props.secretOptionsLoaded) commandSecret.setSecretOptions(secretOptionValues.value)
}

function syncFormSecretOptions(): void {
	if (props.secretOptionsLoaded) props.form.setSecretOptions(secretOptionValues.value)
	else props.form.clearSecretOptions()
}

function syncRequirementSecretOptions(requirement: RuntimeRequirementFormDraft): void {
	if (props.secretOptionsLoaded) requirement.setSecretOptions(secretOptionValues.value)
	else requirement.clearSecretOptions()
}

function selectOptionValues(options: readonly UiSelectOptionInput<string>[]): string[] {
	return options.flatMap((option) => ('options' in option ? option.options.map((groupOption) => groupOption.value) : [option.value]))
}
</script>
