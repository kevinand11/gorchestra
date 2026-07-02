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

export const secretBindingScopePipe = v.discriminate((value) => value.type, {
	portfolio: v.object({ type: v.eq('portfolio') }),
	project: v.object({ type: v.eq('project'), projectId: idPipe }),
	delivery: v.object({ type: v.eq('delivery'), deliveryId: idPipe }),
})
export type SecretBindingScope = PipeOutput<typeof secretBindingScopePipe>

export const secretBindingPipe = v.object({
	id: idPipe,
	secretId: idPipe,
	scope: secretBindingScopePipe,
	envName: envNamePipe,
	created: auditStampPipe,
	archivePeriods: v.array(archivePeriodPipe),
})
export type SecretBinding = PipeOutput<typeof secretBindingPipe>

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

export const secretBindingSecretReferencePipe = v.object({
	type: v.eq('secret-binding'),
	active: v.boolean(),
	secretBindingId: idPipe,
	scope: secretBindingScopePipe,
	envName: envNamePipe,
})
export type SecretBindingSecretReference = PipeOutput<typeof secretBindingSecretReferencePipe>

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
	'secret-binding': secretBindingSecretReferencePipe,
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
