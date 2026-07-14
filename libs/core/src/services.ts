import { Repo, type AnySchema, type AnyUpdateOp, type FilterGroup, type OrmAdapterLike, type QueryOptions } from 'equipped/orm'
import { v, type PipeOutput } from 'valleyed'

import type { AgentRunSandboxConfig, AgentRunSandboxSourceConfig, ConsumerManagedSandboxSourceConfig } from './domain/agent-run-runtime'
import { freeFormStringPipe, idPipe, nonEmptyTrimmedStringPipe, nonNegativeIntegerPipe, type Id } from './domain/commons'
import type { Notification } from './domain/notifications'
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
}

export type CorePreflightCheck = { ok: true } | { ok: false; reason: 'not-ready' | 'probe-failed'; message: string | null }

export type CoreStorageAdapter = OrmAdapterLike<{ table: string }> & {
	findByPk(schema: AnySchema, config: unknown, pk: unknown): Promise<Record<string, unknown> | null>
	createMany(schema: AnySchema, config: unknown, data: Record<string, unknown>[]): Promise<Record<string, unknown>[]>
	updateByPk(schema: AnySchema, config: unknown, pk: unknown, ops: AnyUpdateOp[]): Promise<Record<string, unknown> | null>
	findMany(schema: AnySchema, config: unknown, group: FilterGroup, options?: QueryOptions): Promise<Record<string, unknown>[]>
	updateMany(schema: AnySchema, config: unknown, group: FilterGroup, data: Record<string, unknown>): Promise<Record<string, unknown>[]>
	deleteMany(schema: AnySchema, config: unknown, group: FilterGroup): Promise<Record<string, unknown>[]>
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

export const sandboxCommandOutputPipe = v.object({
	exitCode: nonNegativeIntegerPipe,
	summary: nonEmptyTrimmedStringPipe,
	stdout: v.nullable(freeFormStringPipe),
	stderr: v.nullable(freeFormStringPipe),
})
export type SandboxCommandOutput = PipeOutput<typeof sandboxCommandOutputPipe>

export const sandboxReleaseOutputPipe = v.object({ summary: nonEmptyTrimmedStringPipe })
export type SandboxReleaseOutput = PipeOutput<typeof sandboxReleaseOutputPipe>

export const sandboxFileEntryPipe = v.object({
	name: nonEmptyTrimmedStringPipe,
	type: v.in(['file', 'directory', 'other']),
})
export type SandboxFileEntry = PipeOutput<typeof sandboxFileEntryPipe>

export const sandboxReadFileOutputPipe = v.nullable(
	v.discriminate((value) => value.type, {
		file: v.object({ type: v.eq('file'), contentsBase64: freeFormStringPipe }),
		directory: v.object({ type: v.eq('directory') }),
		other: v.object({ type: v.eq('other') }),
	}),
)
export type SandboxReadFileOutput = PipeOutput<typeof sandboxReadFileOutputPipe>

export const sandboxListDirectoryOutputPipe = v.nullable(
	v.discriminate((value) => value.type, {
		directory: v.object({ type: v.eq('directory'), entries: v.array(sandboxFileEntryPipe) }),
		file: v.object({ type: v.eq('file') }),
		other: v.object({ type: v.eq('other') }),
	}),
)
export type SandboxListDirectoryOutput = PipeOutput<typeof sandboxListDirectoryOutputPipe>

export interface RawSandboxRunCommandInput {
	command: { executable: string; args: string[]; cwd: string }
	env: Record<string, string>
	root: boolean
	timeoutMs: number
}

export interface RawSandbox {
	runCommand(input: RawSandboxRunCommandInput): Promise<SandboxCommandOutput>
	readFile(path: string): Promise<SandboxReadFileOutput>
	writeFile(path: string, contentsBase64: string): Promise<void>
	listDirectory(path: string): Promise<SandboxListDirectoryOutput>
	deletePath(path: string): Promise<void>
	release(): Promise<SandboxReleaseOutput>
}

export type AgentRunSandboxConfigForSource<SourceConfig extends AgentRunSandboxSourceConfig> = Omit<AgentRunSandboxConfig, 'source'> & {
	source: SourceConfig
}

export interface RawSandboxProvider<SourceConfig extends AgentRunSandboxSourceConfig = AgentRunSandboxSourceConfig> {
	kind: SourceConfig['type']
	create(input: { key: string; config: AgentRunSandboxConfigForSource<SourceConfig> }): Promise<RawSandbox>
	find(input: { key: string }): Promise<RawSandbox | null>
}

export type ConsumerManagedSandboxProvider = RawSandboxProvider<ConsumerManagedSandboxSourceConfig>

export const rawSandboxPipe = v.object({
	runCommand: typedFunctionDependencyPipe<RawSandbox['runCommand']>(),
	readFile: typedFunctionDependencyPipe<RawSandbox['readFile']>(),
	writeFile: typedFunctionDependencyPipe<RawSandbox['writeFile']>(),
	listDirectory: typedFunctionDependencyPipe<RawSandbox['listDirectory']>(),
	deletePath: typedFunctionDependencyPipe<RawSandbox['deletePath']>(),
	release: typedFunctionDependencyPipe<RawSandbox['release']>(),
})
export type RawSandboxOutput = PipeOutput<typeof rawSandboxPipe>

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
	kind: v.eq('consumer-managed'),
	create: typedFunctionDependencyPipe<ConsumerManagedSandboxProvider['create']>(),
	find: typedFunctionDependencyPipe<ConsumerManagedSandboxProvider['find']>(),
})
export type CoreSandboxService = ConsumerManagedSandboxProvider

export const coreDispatchWakeServicePipe = v.object({
	publish: typedFunctionDependencyPipe<() => void>(),
	subscribe: typedFunctionDependencyPipe<(listener: () => void) => () => void>(),
})
export type CoreDispatchWakeService = PipeOutput<typeof coreDispatchWakeServicePipe>

const coreNotificationsServicePipe = v.object({
	publish: typedFunctionDependencyPipe<(notification: Notification) => void>(),
})
export type CoreNotificationsService = PipeOutput<typeof coreNotificationsServicePipe>

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
	dispatchWake: v.optional(coreDispatchWakeServicePipe),
	logger: v.optional(coreLoggerPipe),
	notifications: v.optional(coreNotificationsServicePipe),
})
export type CoreServices = UndefinedToOptional<PipeOutput<typeof coreServicesPipe>>

function typedFunctionDependencyPipe<Fn extends (...args: never[]) => unknown>() {
	return v.any<Fn>().pipe(v.custom((value) => typeof value === 'function', 'Expected a function dependency.'))
}
