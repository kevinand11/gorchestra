import { v, type PipeOutput } from 'valleyed'

import { archivePeriodPipe, auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'

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

export type ResolvedSecretEnvironment = Array<{
	envName: string
	secretId: Secret['id']
}>
