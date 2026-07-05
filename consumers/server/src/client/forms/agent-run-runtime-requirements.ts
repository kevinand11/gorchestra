import { FormDraft, formDraftPipe, type FormDraftArray } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { AgentRunRuntimeRequirement, AgentRunRunCommandRequirement } from '../composables/core/server-api'

type RuntimeRequirementType = AgentRunRuntimeRequirement['type']

type CommandSecretEnvFormFields = {
	envName: string
	secretId: string
}

type RuntimeRequirementFormFields = {
	type: RuntimeRequirementType
	envName: string
	secretId: string
	label: string
	executable: string
	argsText: string
	cwdText: string
	commandSecretEnv: FormDraftArray<CommandSecretEnvFormDraft>
}

const runtimeRequirementTypePipe = v.in(['environment-secret', 'run-command'])
const envNamePipe = v.string().pipe(v.custom(isEnvName, 'Use an uppercase environment variable name'))
const secretIdPipe = v.string().pipe(v.min<string>(1, 'Enter a Secret id'))
const cwdTextPipe = v.string().pipe(v.custom(isCwdText, 'Use /workspace or a path under /workspace'))

export class CommandSecretEnvFormDraft extends FormDraft<
	CommandSecretEnvFormFields,
	CommandSecretEnvFormFields,
	CommandSecretEnvFormFields
> {
	protected readonly rules = { envName: envNamePipe, secretId: secretIdPipe }

	constructor() {
		super({ envName: '', secretId: '' })
	}

	protected model = (): CommandSecretEnvFormFields => ({ envName: this.envName, secretId: this.secretId })

	protected load = (entity: CommandSecretEnvFormFields): void => {
		this.envName = entity.envName
		this.secretId = entity.secretId
	}
}

export class RuntimeRequirementFormDraft extends FormDraft<
	AgentRunRuntimeRequirement,
	AgentRunRuntimeRequirement,
	RuntimeRequirementFormFields
> {
	protected readonly rules = {
		type: runtimeRequirementTypePipe,
		envName: v
			.string()
			.pipe(
				v.custom((value) => this.type !== 'environment-secret' || isEnvName(value), 'Use an uppercase environment variable name'),
			),
		secretId: v.string().pipe(v.custom((value) => this.type !== 'environment-secret' || value.length > 0, 'Enter a Secret id')),
		label: v.string().pipe(v.custom((value) => this.type !== 'run-command' || value.length > 0, 'Enter a command label')),
		executable: v.string().pipe(v.custom((value) => this.type !== 'run-command' || value.length > 0, 'Enter an executable')),
		argsText: v.string(),
		cwdText: cwdTextPipe,
		commandSecretEnv: formDraftPipe<FormDraftArray<CommandSecretEnvFormDraft>>(),
	}

	constructor(type: RuntimeRequirementType = 'environment-secret') {
		super({
			type,
			envName: '',
			secretId: '',
			label: '',
			executable: '',
			argsText: '',
			cwdText: '',
			commandSecretEnv: FormDraft.asArray(() => new CommandSecretEnvFormDraft()),
		})
		this.type = type
	}

	protected model = (): AgentRunRuntimeRequirement => {
		switch (this.type) {
			case 'environment-secret':
				return { type: 'environment-secret', envName: this.envName.trim(), secretId: this.secretId.trim() }
			case 'run-command':
				return {
					type: 'run-command',
					label: this.label.trim(),
					command: { executable: this.executable.trim(), args: argsFromText(this.argsText), cwd: cwdFromText(this.cwdText) },
					commandSecretEnv: commandSecretEnvFromRows(this.commandSecretEnv.toModel()),
				}
			default:
				throw new Error(`Unexpected Runtime Requirement type: ${String(this.type satisfies never)}`)
		}
	}

	protected load = (entity: AgentRunRuntimeRequirement): void => {
		this.type = entity.type
		switch (entity.type) {
			case 'environment-secret':
				this.envName = entity.envName
				this.secretId = entity.secretId
				this.label = ''
				this.executable = ''
				this.argsText = ''
				this.cwdText = ''
				this.commandSecretEnv.loadEntity([])
				return
			case 'run-command':
				this.envName = ''
				this.secretId = ''
				this.label = entity.label
				this.executable = entity.command.executable
				this.argsText = entity.command.args.join('\n')
				this.cwdText = entity.command.cwd ?? ''
				this.commandSecretEnv.loadEntity(commandSecretEnvRows(entity))
				return
			default:
				throw new Error(`Unexpected Runtime Requirement type: ${String(entity satisfies never)}`)
		}
	}
}

export type RuntimeRequirementFormArray = FormDraftArray<RuntimeRequirementFormDraft>

export function runtimeRequirementFormArray(): RuntimeRequirementFormArray {
	return FormDraft.asArray(() => new RuntimeRequirementFormDraft())
}

function argsFromText(argsText: string): string[] {
	return argsText.split('\n').filter((line) => line.length > 0)
}

function cwdFromText(cwdText: string): string | null {
	const trimmed = cwdText.trim()
	return trimmed.length === 0 ? null : trimmed
}

function commandSecretEnvFromRows(rows: CommandSecretEnvFormFields[]): Record<string, string> {
	return Object.fromEntries(rows.map((row) => [row.envName.trim(), row.secretId.trim()]))
}

function commandSecretEnvRows(requirement: AgentRunRunCommandRequirement): CommandSecretEnvFormFields[] {
	return Object.entries(requirement.commandSecretEnv).map(([envName, secretId]) => ({ envName, secretId }))
}

function isEnvName(value: string): boolean {
	return /^[A-Z_][A-Z0-9_]*$/.test(value.trim())
}

function isCwdText(value: string): boolean {
	const trimmed = value.trim()
	return trimmed.length === 0 || ((trimmed === '/workspace' || trimmed.startsWith('/workspace/')) && !trimmed.split('/').includes('..'))
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('RuntimeRequirementFormDraft', () => {
		it('models environment Secret and structured Run Command requirements', () => {
			const env = new RuntimeRequirementFormDraft('environment-secret')
			env.envName = 'NPM_TOKEN'
			env.secretId = 'secret-1'

			expect(env.toModel()).toEqual({ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: 'secret-1' })

			const command = new RuntimeRequirementFormDraft('run-command')
			command.label = 'Install packages'
			command.executable = 'pnpm'
			command.argsText = 'install\n--frozen-lockfile'
			command.cwdText = '/workspace/repos/repository-1'
			const commandSecret = command.commandSecretEnv.add()
			commandSecret.envName = 'NPM_TOKEN'
			commandSecret.secretId = 'secret-1'

			expect(command.toModel()).toEqual({
				type: 'run-command',
				label: 'Install packages',
				command: { executable: 'pnpm', args: ['install', '--frozen-lockfile'], cwd: '/workspace/repos/repository-1' },
				commandSecretEnv: { NPM_TOKEN: 'secret-1' },
			})
		})
	})
}
