import { v, type PipeOutput } from 'valleyed'

import { archivePeriodPipe, auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'
import { modelProviderProtocolPipe } from './model-provider'

export const secretValueRefPipe = nonEmptyTrimmedStringPipe
export const envNamePipe = nonEmptyTrimmedStringPipe.pipe(
	v.custom<string>((value) => /^[A-Z_][A-Z0-9_]*$/.test(value), 'Expected an environment variable name.'),
)

export const secretPipe = v.object({
	id: idPipe,
	name: nonEmptyTrimmedStringPipe,
	valueRef: nonEmptyTrimmedStringPipe,
	created: auditStampPipe,
	replaced: v.nullable(auditStampPipe),
	archivePeriods: v.array(archivePeriodPipe),
})
export type Secret = PipeOutput<typeof secretPipe>

export const repositoryAccessSecretReferencePipe = v.object({
	type: v.eq('repository-access'),
	active: v.boolean(),
	repositoryId: idPipe,
	projectId: idPipe,
	provider: v.eq('github'),
	owner: nonEmptyTrimmedStringPipe,
	name: nonEmptyTrimmedStringPipe,
})
export type RepositoryAccessSecretReference = PipeOutput<typeof repositoryAccessSecretReferencePipe>

export const agentRunProfileEnvironmentSecretReferencePipe = v.object({
	type: v.eq('agent-run-profile-environment-secret'),
	active: v.boolean(),
	agentRunProfileId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	envName: envNamePipe,
})
export type AgentRunProfileEnvironmentSecretReference = PipeOutput<typeof agentRunProfileEnvironmentSecretReferencePipe>

export const agentRunProfileRunCommandSecretReferencePipe = v.object({
	type: v.eq('agent-run-profile-run-command-secret'),
	active: v.boolean(),
	agentRunProfileId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	label: nonEmptyTrimmedStringPipe,
	envName: envNamePipe,
})
export type AgentRunProfileRunCommandSecretReference = PipeOutput<typeof agentRunProfileRunCommandSecretReferencePipe>

export const agentRunProfileSandboxCredentialSecretReferencePipe = v.object({
	type: v.eq('agent-run-profile-sandbox-credential'),
	active: v.boolean(),
	agentRunProfileId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	credential: v.in(['vercel-token', 'vercel-team-id', 'vercel-project-id']),
})
export type AgentRunProfileSandboxCredentialSecretReference = PipeOutput<typeof agentRunProfileSandboxCredentialSecretReferencePipe>

export const modelProviderAuthSecretReferencePipe = v.object({
	type: v.eq('model-provider-auth'),
	active: v.boolean(),
	modelProviderId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	protocol: modelProviderProtocolPipe,
})
export type ModelProviderAuthSecretReference = PipeOutput<typeof modelProviderAuthSecretReferencePipe>

export const modelProviderHeaderSecretReferencePipe = v.object({
	type: v.eq('model-provider-header'),
	active: v.boolean(),
	modelProviderId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	protocol: modelProviderProtocolPipe,
	headerName: nonEmptyTrimmedStringPipe,
})
export type ModelProviderHeaderSecretReference = PipeOutput<typeof modelProviderHeaderSecretReferencePipe>

export const secretReferencePipe = v.discriminate((value) => value.type, {
	'repository-access': repositoryAccessSecretReferencePipe,
	'agent-run-profile-environment-secret': agentRunProfileEnvironmentSecretReferencePipe,
	'agent-run-profile-run-command-secret': agentRunProfileRunCommandSecretReferencePipe,
	'agent-run-profile-sandbox-credential': agentRunProfileSandboxCredentialSecretReferencePipe,
	'model-provider-auth': modelProviderAuthSecretReferencePipe,
	'model-provider-header': modelProviderHeaderSecretReferencePipe,
})
export type SecretReference = PipeOutput<typeof secretReferencePipe>

export const listedSecretPipe = v.object({
	id: idPipe,
	name: nonEmptyTrimmedStringPipe,
	created: auditStampPipe,
	replaced: v.nullable(auditStampPipe),
	archived: v.boolean(),
	references: v.array(secretReferencePipe),
})
export type ListedSecret = PipeOutput<typeof listedSecretPipe>

export type ResolvedSecretEnvironment = Array<{
	envName: string
	secretId: Secret['id']
}>
