import { Repo, type AnySchema, type AnyUpdateOp, type FilterGroup, type OrmAdapterLike, type QueryOptions } from 'equipped/orm'
import { v, type PipeOutput } from 'valleyed'

import { idPipe, type Id } from './domain/commons'
import type { UndefinedToOptional } from './utils/types'

export const coreServicePreflightOutputPipe = v.discriminate((v) => v.ok.toString(), {
	true: v.object({ ok: v.is(true) }),
	false: v.object({ ok: v.is(false), message: v.nullable(v.string()) }),
})
export type CoreServicePreflightOutput = PipeOutput<typeof coreServicePreflightOutputPipe>

export interface CorePreflightReport {
	passed: boolean
	checks: CorePreflightChecks
}

export interface CorePreflightChecks {
	storage: CorePreflightCheck
	secrets: CorePreflightCheck
	sandbox: CorePreflightCheck
	dispatcher: CorePreflightCheck
}

export type CorePreflightCheck = { ok: true } | { ok: false; reason: 'not-ready' | 'probe-failed'; message: string | null }

export type CoreStorageAdapter = OrmAdapterLike<{ table: string }> & {
	findByPk(schema: AnySchema, config: unknown, pk: unknown): Promise<Record<string, unknown> | null>
	createMany(schema: AnySchema, config: unknown, data: Record<string, unknown>[]): Promise<Record<string, unknown>[]>
	updateByPk(schema: AnySchema, config: unknown, pk: unknown, ops: AnyUpdateOp[]): Promise<Record<string, unknown> | null>
	findMany(schema: AnySchema, config: unknown, group: FilterGroup, options?: QueryOptions): Promise<Record<string, unknown>[]>
	updateMany(schema: AnySchema, config: unknown, group: FilterGroup, data: Record<string, unknown>): Promise<Record<string, unknown>[]>
	session<T>(fn: () => Promise<T>): Promise<T>
}

export interface ResolveSecretsInput {
	scope: { type: 'project'; projectId: Id } | { type: 'delivery'; deliveryId: Id }
}

export interface ResolvableSecretValue {
	secretId: Id
	valueRef: string
}

export interface ResolveSecretValuesInput {
	secrets: ResolvableSecretValue[]
}

export interface ResolvedSecret {
	secretId: Id
	envName: string

	/** Plaintext exists only transiently. */
	plaintext: string
}

/** Plaintext values exist only transiently. */
export const resolvedSecretValuesPipe = v.record(idPipe, v.string())
export type ResolvedSecretValues = Record<Id, string>

export type CoreDispatchRequest = {
	type: 'agent-run'
	agentRunId: Id
	serializationKey: string
	reason: { type: 'input-appended'; inputEventId: Id }
}

export type CoreEvent = never

type PreflightFn = () => Promise<CoreServicePreflightOutput>

export const storagePipe = v.instanceOf(Repo<CoreStorageAdapter>)
export type CoreStorageService = PipeOutput<typeof storagePipe>
export type CoreStorage = CoreStorageService

export const coreSecretsServicePipe = v.object({
	preflight: typedFunctionDependencyPipe<PreflightFn>(),
	resolveSecrets: typedFunctionDependencyPipe<(input: ResolveSecretsInput) => Promise<ResolvedSecret[]>>(),
	resolveSecretValues: typedFunctionDependencyPipe<(input: ResolveSecretValuesInput) => Promise<ResolvedSecretValues>>(),
})
export type CoreSecretsService = PipeOutput<typeof coreSecretsServicePipe>

export const coreSandboxServicePipe = v.object({
	preflight: typedFunctionDependencyPipe<PreflightFn>(),
})
export type CoreSandboxService = PipeOutput<typeof coreSandboxServicePipe>

export const coreDispatcherServicePipe = v.object({
	preflight: typedFunctionDependencyPipe<PreflightFn>(),
	request: typedFunctionDependencyPipe<(input: CoreDispatchRequest) => Promise<string>>(),
	ready: typedFunctionDependencyPipe<(marker: string) => void>(),
})
export type CoreDispatcherService = PipeOutput<typeof coreDispatcherServicePipe>

const coreEventSinkPipe = v.object({
	publish: typedFunctionDependencyPipe<(event: CoreEvent) => void>(),
})
export type CoreEventSink = PipeOutput<typeof coreEventSinkPipe>

const coreLoggerPipe = v.object({
	debug: typedFunctionDependencyPipe<(message: string, context: Record<string, unknown> | null) => void>(),
	info: typedFunctionDependencyPipe<(message: string, context: Record<string, unknown> | null) => void>(),
	warn: typedFunctionDependencyPipe<(message: string, context: Record<string, unknown> | null) => void>(),
	error: typedFunctionDependencyPipe<(message: string, context: Record<string, unknown> | null) => void>(),
})
export type CoreLogger = PipeOutput<typeof coreLoggerPipe>

export const coreServicesPipe = v.object({
	storage: storagePipe,
	secrets: coreSecretsServicePipe,
	sandbox: coreSandboxServicePipe,
	dispatcher: coreDispatcherServicePipe,
	logger: v.optional(coreLoggerPipe),
	eventSink: v.optional(coreEventSinkPipe),
})
export type CoreServices = UndefinedToOptional<PipeOutput<typeof coreServicesPipe>>

function typedFunctionDependencyPipe<Fn extends (...args: never[]) => unknown>() {
	return v.any<Fn>().pipe(v.custom((value) => typeof value === 'function', 'Expected a function dependency.'))
}
