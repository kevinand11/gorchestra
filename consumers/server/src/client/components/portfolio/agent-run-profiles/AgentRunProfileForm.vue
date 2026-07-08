<template>
	<UiForm @submit.prevent="emit('submit')">
		<div class="px-3">
			<UiFormGroup label="Name" for-id="agent-run-profile-name" :error="form.errors.name">
				<UiInput id="agent-run-profile-name" v-model="form.name" :invalid="!!form.errors.name" />
			</UiFormGroup>
		</div>

		<section class="mt-6 border-t border-dimmer px-3 pt-4">
			<div>
				<UiText class="font-semibold">Model use</UiText>
				<UiText tone="muted" size="helper">Choose the Model id and thinking level future Agent Runs snapshot.</UiText>
			</div>

			<div class="mt-4 grid gap-3 md:grid-cols-2">
				<UiFormGroup label="Model id" for-id="agent-run-profile-model" :error="form.modelUse.errors.modelId">
					<UiSelect
						id="agent-run-profile-model"
						v-model="form.modelUse.modelId.value"
						:options="modelSelect.modelOptions.value"
						placeholder="Select Model"
						:invalid="!!form.modelUse.errors.modelId" />
				</UiFormGroup>
				<UiFormGroup label="Thinking level" for-id="agent-run-profile-thinking" :error="form.modelUse.errors.thinkingLevel">
					<UiSelect
						id="agent-run-profile-thinking"
						v-model="form.modelUse.thinkingLevel.value"
						:options="modelSelect.thinkingLevelOptions.value"
						placeholder="Select thinking"
						:invalid="!!form.modelUse.errors.thinkingLevel" />
				</UiFormGroup>
			</div>
		</section>

		<section class="mt-6 border-t border-dimmer px-3 pt-4">
			<div>
				<UiText class="font-semibold">Sandbox</UiText>
				<UiText tone="muted" size="helper">
					Choose the sandbox source and resource policy used before Agent Run model turns.
				</UiText>
			</div>

			<div class="mt-4 grid gap-3 md:grid-cols-3">
				<UiFormGroup label="Source" for-id="agent-run-profile-sandbox-source" :error="form.sandboxConfig.source.errors.type">
					<UiSelect
						id="agent-run-profile-sandbox-source"
						v-model="form.sandboxConfig.source.type"
						:options="sandboxSourceTypeOptions"
						placeholder="Select sandbox source"
						:invalid="!!form.sandboxConfig.source.errors.type" />
				</UiFormGroup>

				<UiFormGroup
					v-if="form.sandboxConfig.source.type === 'consumer-managed'"
					label="OCI image"
					for-id="agent-run-profile-sandbox-oci-image"
					:error="form.sandboxConfig.source.errors.ociImage">
					<UiInput
						id="agent-run-profile-sandbox-oci-image"
						v-model="form.sandboxConfig.source.ociImage"
						placeholder="ghcr.io/gorchestra/sandbox-node:latest"
						:invalid="!!form.sandboxConfig.source.errors.ociImage" />
				</UiFormGroup>

				<UiFormGroup
					v-if="form.sandboxConfig.source.type === 'vercel-runtime'"
					label="Vercel runtime"
					for-id="agent-run-profile-sandbox-vercel-runtime"
					:error="form.sandboxConfig.source.errors.runtime">
					<UiSelect
						id="agent-run-profile-sandbox-vercel-runtime"
						v-model="form.sandboxConfig.source.runtime"
						:options="vercelRuntimeOptions"
						placeholder="Select runtime"
						:invalid="!!form.sandboxConfig.source.errors.runtime" />
				</UiFormGroup>

				<UiFormGroup
					v-if="form.sandboxConfig.source.type === 'vercel-vcr-image'"
					label="Vercel VCR image"
					for-id="agent-run-profile-sandbox-vcr-image"
					:error="form.sandboxConfig.source.errors.vcrImage">
					<UiInput
						id="agent-run-profile-sandbox-vcr-image"
						v-model="form.sandboxConfig.source.vcrImage"
						placeholder="my-repo:latest"
						:invalid="!!form.sandboxConfig.source.errors.vcrImage" />
				</UiFormGroup>
			</div>

			<div v-if="form.sandboxConfig.source.type !== 'consumer-managed'" class="mt-4 grid gap-3 md:grid-cols-3">
				<UiFormGroup
					label="Vercel token Secret"
					for-id="agent-run-profile-sandbox-vercel-token"
					:error="form.sandboxConfig.source.credentials.tokenSecretId.errors.value">
					<UiSelect
						id="agent-run-profile-sandbox-vercel-token"
						v-model="form.sandboxConfig.source.credentials.tokenSecretId.value"
						:options="secretOptions"
						placeholder="Select Secret"
						:invalid="!!form.sandboxConfig.source.credentials.tokenSecretId.errors.value" />
				</UiFormGroup>
				<UiFormGroup
					label="Vercel team id Secret"
					for-id="agent-run-profile-sandbox-vercel-team"
					:error="form.sandboxConfig.source.credentials.teamIdSecretId.errors.value">
					<UiSelect
						id="agent-run-profile-sandbox-vercel-team"
						v-model="form.sandboxConfig.source.credentials.teamIdSecretId.value"
						:options="secretOptions"
						placeholder="Select Secret"
						:invalid="!!form.sandboxConfig.source.credentials.teamIdSecretId.errors.value" />
				</UiFormGroup>
				<UiFormGroup
					label="Vercel project id Secret"
					for-id="agent-run-profile-sandbox-vercel-project"
					:error="form.sandboxConfig.source.credentials.projectIdSecretId.errors.value">
					<UiSelect
						id="agent-run-profile-sandbox-vercel-project"
						v-model="form.sandboxConfig.source.credentials.projectIdSecretId.value"
						:options="secretOptions"
						placeholder="Select Secret"
						:invalid="!!form.sandboxConfig.source.credentials.projectIdSecretId.errors.value" />
				</UiFormGroup>
			</div>

			<div class="mt-4 grid items-start gap-3 md:grid-cols-3">
				<div>
					<UiFormGroup label="vCPUs" for-id="agent-run-profile-sandbox-vcpus" :error="form.sandboxConfig.resources.errors.vcpus">
						<UiInput
							id="agent-run-profile-sandbox-vcpus"
							v-model="form.sandboxConfig.resources.vcpus"
							type="number"
							min="1"
							:invalid="!!form.sandboxConfig.resources.errors.vcpus" />
					</UiFormGroup>
					<p class="m-0 mt-1 text-sz-helper text-dim">Inferred memory: {{ inferredSandboxMemoryMiB }} MiB</p>
				</div>
				<UiFormGroup
					label="Network"
					for-id="agent-run-profile-sandbox-network"
					:error="form.sandboxConfig.networkPolicy.errors.type">
					<UiSelect
						id="agent-run-profile-sandbox-network"
						v-model="form.sandboxConfig.networkPolicy.type"
						:options="networkPolicyOptions"
						placeholder="Select network policy"
						:invalid="!!form.sandboxConfig.networkPolicy.errors.type" />
				</UiFormGroup>
			</div>

			<div v-if="form.sandboxConfig.networkPolicy.type === 'allow-list'" class="mt-4 grid gap-4 md:grid-cols-3">
				<div>
					<div class="mb-2 flex items-center justify-between gap-2">
						<UiText class="font-medium">Allowed hosts</UiText>
						<UiButton type="button" variant="secondary" @click="form.sandboxConfig.networkPolicy.hosts.add()">Add</UiButton>
					</div>
					<div
						v-for="(host, index) in [...form.sandboxConfig.networkPolicy.hosts]"
						:key="index"
						class="grid gap-2 py-1 md:grid-cols-[1fr_auto]">
						<UiFormGroup :label="`Host ${index + 1}`" :for-id="`sandbox-host-${index}`" :error="host.errors.value">
							<UiInput
								:id="`sandbox-host-${index}`"
								v-model="host.value"
								placeholder="registry.npmjs.org"
								:invalid="!!host.errors.value" />
						</UiFormGroup>
						<div class="flex items-end">
							<UiButton type="button" variant="secondary" @click="form.sandboxConfig.networkPolicy.hosts.delete(index)"
								>Remove</UiButton
							>
						</div>
					</div>
				</div>

				<div>
					<div class="mb-2 flex items-center justify-between gap-2">
						<UiText class="font-medium">Allowed subnets</UiText>
						<UiButton type="button" variant="secondary" @click="form.sandboxConfig.networkPolicy.allowSubnets.add()"
							>Add</UiButton
						>
					</div>
					<div
						v-for="(subnet, index) in [...form.sandboxConfig.networkPolicy.allowSubnets]"
						:key="index"
						class="grid gap-2 py-1 md:grid-cols-[1fr_auto]">
						<UiFormGroup :label="`Subnet ${index + 1}`" :for-id="`sandbox-allow-subnet-${index}`" :error="subnet.errors.value">
							<UiInput
								:id="`sandbox-allow-subnet-${index}`"
								v-model="subnet.value"
								placeholder="10.0.0.0/8"
								:invalid="!!subnet.errors.value" />
						</UiFormGroup>
						<div class="flex items-end">
							<UiButton type="button" variant="secondary" @click="form.sandboxConfig.networkPolicy.allowSubnets.delete(index)"
								>Remove</UiButton
							>
						</div>
					</div>
				</div>

				<div>
					<div class="mb-2 flex items-center justify-between gap-2">
						<UiText class="font-medium">Denied subnets</UiText>
						<UiButton type="button" variant="secondary" @click="form.sandboxConfig.networkPolicy.denySubnets.add()"
							>Add</UiButton
						>
					</div>
					<div
						v-for="(subnet, index) in [...form.sandboxConfig.networkPolicy.denySubnets]"
						:key="index"
						class="grid gap-2 py-1 md:grid-cols-[1fr_auto]">
						<UiFormGroup :label="`Subnet ${index + 1}`" :for-id="`sandbox-deny-subnet-${index}`" :error="subnet.errors.value">
							<UiInput
								:id="`sandbox-deny-subnet-${index}`"
								v-model="subnet.value"
								placeholder="10.1.0.0/16"
								:invalid="!!subnet.errors.value" />
						</UiFormGroup>
						<div class="flex items-end">
							<UiButton type="button" variant="secondary" @click="form.sandboxConfig.networkPolicy.denySubnets.delete(index)"
								>Remove</UiButton
							>
						</div>
					</div>
				</div>
			</div>
		</section>

		<section class="mt-6 border-t border-dimmer pt-4">
			<div class="flex flex-wrap items-start justify-between gap-3 px-3">
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

			<div class="mt-3 space-y-2 px-3 text-sm text-body-muted">
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

			<div v-if="form.runtimeRequirements.length === 0" class="mt-4 border-t border-dimmer px-3 pt-4">
				<UiText tone="muted">No runtime requirements. This profile will use only source checkout preparation.</UiText>
			</div>

			<div v-for="(requirement, index) in form.runtimeRequirements" :key="index" class="mt-4 border-t border-dimmer px-3 pt-4">
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
							<UiCheckbox
								v-model="requirement.root"
								description="Run this preparation command with root privileges inside the sandbox. Leave off for normal project commands.">
								Run as root inside sandbox
							</UiCheckbox>
						</div>
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

				<div v-if="requirement.type === 'run-command'" class="mt-4">
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

		<div class="mt-4 flex flex-wrap items-center gap-2 border-t border-dimmer px-3 pt-4">
			<UiButton type="submit" :loading="loading" :disabled="disabled">{{ submitLabel }}</UiButton>
			<UiText v-if="error" tone="error">{{ error }}</UiText>
		</div>
	</UiForm>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import UiButton from '../../ui/UiButton.vue'
import UiCheckbox from '../../ui/UiCheckbox.vue'
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
const sandboxSourceTypeOptions = [
	{ value: 'consumer-managed', label: 'Consumer-managed OCI image' },
	{ value: 'vercel-runtime', label: 'Vercel runtime' },
	{ value: 'vercel-vcr-image', label: 'Vercel VCR image' },
]
const vercelRuntimeOptions = [
	{ value: 'node26', label: 'Node.js 26' },
	{ value: 'node24', label: 'Node.js 24' },
	{ value: 'node22', label: 'Node.js 22' },
	{ value: 'python3.13', label: 'Python 3.13' },
]
const networkPolicyOptions = [
	{ value: 'allow-all', label: 'Allow all network access' },
	{ value: 'deny-all', label: 'Deny all network access' },
	{ value: 'allow-list', label: 'Allow listed hosts/subnets' },
]
const secretOptionValues = computed(() => selectOptionValues(props.secretOptions))
const inferredSandboxMemoryMiB = computed(() => props.form.sandboxConfig.resources.vcpus * 2048)

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
		root: false,
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
