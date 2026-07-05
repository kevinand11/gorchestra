import { FormDraft, FormDraftSelect, nestedFormDraftPipe, type FormDraftArray } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { AgentRunRuntimeRequirement, AgentRunRunCommandRequirement } from '../composables/core/server-api'

type RuntimeRequirementType = AgentRunRuntimeRequirement['type']

type CommandArgFormFields = {
	value: string
}

type CommandSecretEnvModel = {
	envName: string
	secretId: string
}

type CommandSecretEnvFormFields = {
	envName: string
	secretId: FormDraftSelect<string>
}

type RuntimeRequirementFormFields = {
	type: RuntimeRequirementType
	envName: string
	secretId: FormDraftSelect<string>
	label: string
	executable: string
	args: FormDraftArray<CommandArgFormDraft>
	cwdText: string
	commandSecretEnv: FormDraftArray<CommandSecretEnvFormDraft>
}

const runtimeRequirementTypePipe = v.in(['environment-secret', 'run-command'])
const envNamePipe = v.string().pipe(v.custom(isEnvName, 'Use an uppercase environment variable name'))
const secretIdPipe = v.string().pipe(v.min<string>(1, 'Select a Secret'))
const commandLabelPipe = v.string().pipe(v.min<string>(1, 'Enter a command label'))
const executablePipe = v.string().pipe(v.min<string>(1, 'Enter an executable'))
const cwdTextPipe = v.string().pipe(v.custom(isCwdText, 'Use /workspace or a path under /workspace'))

export class CommandArgFormDraft extends FormDraft<string, string, CommandArgFormFields> {
	protected readonly rules = { value: v.string() }

	constructor() {
		super({ value: '' })
	}

	protected model = (): string => this.value

	protected load = (entity: string): void => {
		this.value = entity
	}
}

export class CommandSecretEnvFormDraft extends FormDraft<CommandSecretEnvModel, CommandSecretEnvModel, CommandSecretEnvFormFields> {
	protected readonly rules = {
		envName: envNamePipe,
		secretId: nestedFormDraftPipe<FormDraftSelect<string>>(),
	}

	constructor() {
		super({
			envName: '',
			secretId: new FormDraftSelect<string>({ initialValue: '', pipe: secretIdPipe }),
		})
	}

	setSecretOptions(secretIds: readonly string[]): void {
		this.secretId.setOptions(secretIds)
	}

	clearSecretOptions(): void {
		this.secretId.clearOptions()
	}

	protected model = (): CommandSecretEnvModel => ({ envName: this.envName, secretId: this.secretId.toModel() })

	protected load = (entity: CommandSecretEnvModel): void => {
		this.envName = entity.envName
		this.secretId.loadEntity(entity.secretId)
	}
}

export class RuntimeRequirementFormDraft extends FormDraft<
	AgentRunRuntimeRequirement,
	AgentRunRuntimeRequirement,
	RuntimeRequirementFormFields
> {
	protected override readonly onSet = {
		type: () => this.revalidate('envName', 'secretId', 'label', 'executable', 'args', 'cwdText', 'commandSecretEnv'),
	}

	protected readonly rules = {
		type: runtimeRequirementTypePipe,
		envName: v.conditional(envNamePipe, () => this.type === 'environment-secret'),
		secretId: v.conditional(nestedFormDraftPipe<FormDraftSelect<string>>(), () => this.type === 'environment-secret'),
		label: v.conditional(commandLabelPipe, () => this.type === 'run-command'),
		executable: v.conditional(executablePipe, () => this.type === 'run-command'),
		args: v.conditional(v.array(nestedFormDraftPipe<CommandArgFormDraft>()), () => this.type === 'run-command'),
		cwdText: v.conditional(cwdTextPipe, () => this.type === 'run-command'),
		commandSecretEnv: v.conditional(v.array(nestedFormDraftPipe<CommandSecretEnvFormDraft>()), () => this.type === 'run-command'),
	}

	constructor(type: RuntimeRequirementType = 'environment-secret') {
		super({
			type,
			envName: '',
			secretId: new FormDraftSelect<string>({ initialValue: '', pipe: secretIdPipe }),
			label: '',
			executable: '',
			args: FormDraft.array(() => new CommandArgFormDraft()),
			cwdText: '',
			commandSecretEnv: FormDraft.array(() => new CommandSecretEnvFormDraft()),
		})
		this.type = type
	}

	setSecretOptions(secretIds: readonly string[]): void {
		this.secretId.setOptions(secretIds)
		for (const commandSecret of this.commandSecretEnv) commandSecret.setSecretOptions(secretIds)
	}

	clearSecretOptions(): void {
		this.secretId.clearOptions()
		for (const commandSecret of this.commandSecretEnv) commandSecret.clearSecretOptions()
	}

	protected model = (): AgentRunRuntimeRequirement => {
		switch (this.type) {
			case 'environment-secret':
				return { type: 'environment-secret', envName: this.envName.trim(), secretId: this.secretId.toModel() }
			case 'run-command':
				return {
					type: 'run-command',
					label: this.label.trim(),
					command: { executable: this.executable.trim(), args: this.args.toModel(), cwd: cwdFromText(this.cwdText) },
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
				this.secretId.loadEntity(entity.secretId)
				this.label = ''
				this.executable = ''
				this.args.loadEntity([])
				this.cwdText = ''
				this.commandSecretEnv.loadEntity([])
				return
			case 'run-command':
				this.envName = ''
				this.secretId.loadEntity('')
				this.label = entity.label
				this.executable = entity.command.executable
				this.args.loadEntity(entity.command.args)
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
	return FormDraft.array(() => new RuntimeRequirementFormDraft())
}

function cwdFromText(cwdText: string): string | null {
	const trimmed = cwdText.trim()
	return trimmed.length === 0 ? null : trimmed
}

function commandSecretEnvFromRows(rows: CommandSecretEnvModel[]): Record<string, string> {
	return Object.fromEntries(rows.map((row) => [row.envName.trim(), row.secretId]))
}

function commandSecretEnvRows(requirement: AgentRunRunCommandRequirement): CommandSecretEnvModel[] {
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
			env.secretId.value = 'secret-1'

			expect(env.toModel()).toEqual({ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: 'secret-1' })

			const command = new RuntimeRequirementFormDraft('run-command')
			command.label = 'Install packages'
			command.executable = 'pnpm'
			command.args.add().value = 'install'
			command.args.add().value = ''
			command.args.add().value = '--frozen-lockfile'
			command.cwdText = '/workspace/repos/repository-1'
			const commandSecret = command.commandSecretEnv.add()
			commandSecret.envName = 'NPM_TOKEN'
			commandSecret.secretId.value = 'secret-1'

			expect(command.toModel()).toEqual({
				type: 'run-command',
				label: 'Install packages',
				command: { executable: 'pnpm', args: ['install', '', '--frozen-lockfile'], cwd: '/workspace/repos/repository-1' },
				commandSecretEnv: { NPM_TOKEN: 'secret-1' },
			})
		})

		it('validates only the fields visible for the selected requirement type', () => {
			const requirement = new RuntimeRequirementFormDraft('environment-secret')
			requirement.envName = 'NPM_TOKEN'
			requirement.secretId.value = 'secret-1'

			expect(requirement.valid).toBe(true)

			requirement.type = 'run-command'

			expect(requirement.valid).toBe(false)

			requirement.label = 'Echo'
			requirement.executable = 'echo'
			const commandSecret = requirement.commandSecretEnv.add()
			commandSecret.envName = 'not-valid'

			expect(requirement.valid).toBe(false)

			requirement.type = 'environment-secret'

			expect(requirement.valid).toBe(true)
		})
	})
}
