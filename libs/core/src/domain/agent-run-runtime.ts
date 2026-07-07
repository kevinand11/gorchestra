import { v, type PipeOutput } from 'valleyed'

import { idPipe, nonEmptyTrimmedStringPipe, nonNegativeIntegerPipe, positiveIntegerPipe, runtimeRecordPipe } from './commons'
import { envNamePipe } from './secret'

export const sandboxPathPipe = nonEmptyTrimmedStringPipe
	.pipe(
		v.custom<string>((value) => value === '/workspace' || value.startsWith('/workspace/'), 'Expected a sandbox path under /workspace.'),
	)
	.pipe(v.custom<string>((value) => !value.split('/').includes('..'), 'Sandbox paths must not contain parent traversal.'))
export type SandboxPath = PipeOutput<typeof sandboxPathPipe>

export const commandSecretEnvPipe = v.record(envNamePipe, idPipe)
export type CommandSecretEnv = PipeOutput<typeof commandSecretEnvPipe>

export const agentRunEnvironmentSecretRequirementPipe = v.object({
	type: v.eq('environment-secret'),
	envName: envNamePipe,
	secretId: idPipe,
})
export type AgentRunEnvironmentSecretRequirement = PipeOutput<typeof agentRunEnvironmentSecretRequirementPipe>

export const agentRunRunCommandRequirementPipe = v.object({
	type: v.eq('run-command'),
	label: nonEmptyTrimmedStringPipe,
	command: v.object({
		executable: nonEmptyTrimmedStringPipe,
		args: v.array(v.string()),
		cwd: v.nullable(sandboxPathPipe),
	}),
	commandSecretEnv: commandSecretEnvPipe,
})
export type AgentRunRunCommandRequirement = PipeOutput<typeof agentRunRunCommandRequirementPipe>

export const agentRunRuntimeRequirementPipe = v.discriminate((value) => value.type, {
	'environment-secret': agentRunEnvironmentSecretRequirementPipe,
	'run-command': agentRunRunCommandRequirementPipe,
})
export type AgentRunRuntimeRequirement = PipeOutput<typeof agentRunRuntimeRequirementPipe>

export const agentRunRuntimeRequirementsPipe = v.array(agentRunRuntimeRequirementPipe)
export type AgentRunRuntimeRequirements = PipeOutput<typeof agentRunRuntimeRequirementsPipe>

export const vercelSandboxRuntimePipe = v.in(['node26', 'node24', 'node22', 'python3.13'])
export type VercelSandboxRuntime = PipeOutput<typeof vercelSandboxRuntimePipe>

export const vercelSandboxCredentialsSecretRefsPipe = v.object({
	tokenSecretId: idPipe,
	teamIdSecretId: idPipe,
	projectIdSecretId: idPipe,
})
export type VercelSandboxCredentialsSecretRefs = PipeOutput<typeof vercelSandboxCredentialsSecretRefsPipe>

export const consumerManagedSandboxSourceConfigPipe = v.object({
	type: v.eq('consumer-managed'),
	ociImage: nonEmptyTrimmedStringPipe,
})
export type ConsumerManagedSandboxSourceConfig = PipeOutput<typeof consumerManagedSandboxSourceConfigPipe>

export const vercelRuntimeSandboxSourceConfigPipe = v.object({
	type: v.eq('vercel-runtime'),
	runtime: vercelSandboxRuntimePipe,
	credentials: vercelSandboxCredentialsSecretRefsPipe,
})
export type VercelRuntimeSandboxSourceConfig = PipeOutput<typeof vercelRuntimeSandboxSourceConfigPipe>

export const vercelVcrImageSandboxSourceConfigPipe = v.object({
	type: v.eq('vercel-vcr-image'),
	vcrImage: nonEmptyTrimmedStringPipe,
	credentials: vercelSandboxCredentialsSecretRefsPipe,
})
export type VercelVcrImageSandboxSourceConfig = PipeOutput<typeof vercelVcrImageSandboxSourceConfigPipe>

export const agentRunSandboxSourceConfigPipe = v.discriminate((value) => value.type, {
	'consumer-managed': consumerManagedSandboxSourceConfigPipe,
	'vercel-runtime': vercelRuntimeSandboxSourceConfigPipe,
	'vercel-vcr-image': vercelVcrImageSandboxSourceConfigPipe,
})
export type AgentRunSandboxSourceConfig = PipeOutput<typeof agentRunSandboxSourceConfigPipe>

export const agentRunSandboxResourcesPipe = v.object({ vcpus: positiveIntegerPipe })
export type AgentRunSandboxResources = PipeOutput<typeof agentRunSandboxResourcesPipe>

export const agentRunSandboxNetworkPolicyPipe = v.discriminate((value) => value.type, {
	'allow-all': v.object({ type: v.eq('allow-all') }),
	'deny-all': v.object({ type: v.eq('deny-all') }),
	'allow-list': v.object({
		type: v.eq('allow-list'),
		hosts: v.array(nonEmptyTrimmedStringPipe),
		subnets: v.object({ allow: v.array(nonEmptyTrimmedStringPipe), deny: v.array(nonEmptyTrimmedStringPipe) }),
	}),
})
export type AgentRunSandboxNetworkPolicy = PipeOutput<typeof agentRunSandboxNetworkPolicyPipe>

export const agentRunSandboxConfigPipe = v.object({
	source: agentRunSandboxSourceConfigPipe,
	resources: agentRunSandboxResourcesPipe,
	networkPolicy: agentRunSandboxNetworkPolicyPipe,
})
export type AgentRunSandboxConfig = PipeOutput<typeof agentRunSandboxConfigPipe>

export function sandboxMemoryMiBForVcpus(vcpus: number): number {
	return vcpus * 2048
}

export const agentRunRuntimeRequirementApplicationTargetPipe = v.discriminate((value) => value.type, {
	'source-checkout': v.object({ type: v.eq('source-checkout') }),
	'runtime-requirement': v.object({
		type: v.eq('runtime-requirement'),
		index: nonNegativeIntegerPipe,
		requirement: agentRunRuntimeRequirementPipe,
	}),
})
export type AgentRunRuntimeRequirementApplicationTarget = PipeOutput<typeof agentRunRuntimeRequirementApplicationTargetPipe>

export const agentRunBlockedPipe = v.nullable(
	v.discriminate((value) => value.type, {
		'sandbox-preparation-pending': v.object({ type: v.eq('sandbox-preparation-pending'), blocked: runtimeRecordPipe }),
		'sandbox-preparation-failed': v.object({
			type: v.eq('sandbox-preparation-failed'),
			blocked: runtimeRecordPipe,
			target: agentRunRuntimeRequirementApplicationTargetPipe,
			summary: nonEmptyTrimmedStringPipe,
		}),
	}),
)
export type AgentRunBlocked = PipeOutput<typeof agentRunBlockedPipe>

export function runtimeRequirementKey(requirement: AgentRunRuntimeRequirement): string {
	switch (requirement.type) {
		case 'environment-secret':
			return `environment-secret:${requirement.envName}:${requirement.secretId}`
		case 'run-command':
			return `run-command:${requirement.label}:${requirement.command.executable}:${JSON.stringify(requirement.command.args)}:${requirement.command.cwd ?? '/workspace'}:${JSON.stringify(sortedCommandSecretEnv(requirement.commandSecretEnv))}`
		default:
			throw new Error(`Unexpected Agent Run Runtime Requirement type: ${String(requirement satisfies never)}`)
	}
}

export function firstDuplicateRuntimeRequirement(requirements: AgentRunRuntimeRequirement[]): AgentRunRuntimeRequirement | null {
	const keys = new Set<string>()
	for (const requirement of requirements) {
		const key = runtimeRequirementKey(requirement)
		if (keys.has(key)) return requirement
		keys.add(key)
	}
	return null
}

export function appendUniqueRuntimeRequirements(
	base: AgentRunRuntimeRequirement[],
	appended: AgentRunRuntimeRequirement[],
): AgentRunRuntimeRequirement[] {
	const keys = new Set(base.map(runtimeRequirementKey))
	const result = [...base]
	for (const requirement of appended) {
		const key = runtimeRequirementKey(requirement)
		if (!keys.has(key)) {
			keys.add(key)
			result.push(requirement)
		}
	}
	return result
}

function sortedCommandSecretEnv(commandSecretEnv: CommandSecretEnv): Array<[string, string]> {
	return Object.entries(commandSecretEnv).sort(([left], [right]) => left.localeCompare(right))
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Agent Run Runtime Requirement domain pipes', () => {
		it('accepts environment Secret requirements with uppercase env names', () => {
			expect(
				v.assert(agentRunRuntimeRequirementPipe, {
					type: 'environment-secret',
					envName: 'NPM_TOKEN',
					secretId: '01k00000000000000000000040',
				}),
			).toEqual({ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: '01k00000000000000000000040' })
		})

		it('rejects invalid environment Secret env names', () => {
			expect(
				v.validate(agentRunRuntimeRequirementPipe, {
					type: 'environment-secret',
					envName: 'npm-token',
					secretId: '01k00000000000000000000040',
				}),
			).toMatchObject({ valid: false })
		})

		it('accepts structured Run Command requirements with command-scoped Secrets', () => {
			expect(
				v.assert(agentRunRuntimeRequirementPipe, {
					type: 'run-command',
					label: 'Install dependencies',
					command: { executable: 'pnpm', args: ['install', '--frozen-lockfile'], cwd: '/workspace/repos/repository-1' },
					commandSecretEnv: { NPM_TOKEN: '01k00000000000000000000040' },
				}),
			).toMatchObject({ type: 'run-command', label: 'Install dependencies' })
		})

		it('rejects host absolute paths as Run Command cwd values', () => {
			expect(
				v.validate(agentRunRuntimeRequirementPipe, {
					type: 'run-command',
					label: 'Bad cwd',
					command: { executable: 'pnpm', args: [], cwd: '/etc' },
					commandSecretEnv: {},
				}),
			).toMatchObject({ valid: false })
		})

		it('finds exact duplicate requirements without rejecting repeated env names with different Secrets', () => {
			const first = { type: 'environment-secret' as const, envName: 'NPM_TOKEN', secretId: '01k00000000000000000000040' }
			const second = { type: 'environment-secret' as const, envName: 'NPM_TOKEN', secretId: '01k00000000000000000000041' }
			expect(firstDuplicateRuntimeRequirement([first, second])).toBeNull()
			expect(firstDuplicateRuntimeRequirement([first, second, first])).toBe(first)
		})
	})

	describe('Agent Run Sandbox Config domain pipes', () => {
		it('accepts Vercel runtime sandbox config with nested credential Secret references', () => {
			expect(
				v.assert(agentRunSandboxConfigPipe, {
					source: {
						type: 'vercel-runtime',
						runtime: 'node24',
						credentials: {
							tokenSecretId: '01k00000000000000000000040',
							teamIdSecretId: '01k00000000000000000000041',
							projectIdSecretId: '01k00000000000000000000042',
						},
					},
					resources: { vcpus: 2 },
					networkPolicy: { type: 'allow-all' },
				}),
			).toMatchObject({ resources: { vcpus: 2 } })
		})

		it('infers sandbox memory from vCPUs', () => {
			expect(sandboxMemoryMiBForVcpus(3)).toBe(6144)
		})
	})
}
