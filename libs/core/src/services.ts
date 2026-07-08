import { Repo, type AnySchema, type AnyUpdateOp, type FilterGroup, type OrmAdapterLike, type QueryOptions } from 'equipped/orm'
import { v, type PipeOutput } from 'valleyed'

import type { DeliveryWorkOperation } from './domain/action'
import type { AgentRunSandboxConfig, AgentRunSandboxSourceConfig, ConsumerManagedSandboxSourceConfig } from './domain/agent-run-runtime'
import { freeFormStringPipe, idPipe, nonEmptyTrimmedStringPipe, nonNegativeIntegerPipe, type Id } from './domain/commons'
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

export type DispatchCoordinationScopeSegment =
	| { type: 'agent-run'; id: Id }
	| { type: 'delivery'; id: Id }
	| { type: 'scheduler' }
	| { type: 'slice-pool' }
	| { type: 'slice'; id: Id }

export type DispatchCoordinationScope = DispatchCoordinationScopeSegment[]

export type DispatchCoordinationClaim = {
	scope: DispatchCoordinationScope
	mode: { type: 'exclusive' } | { type: 'shared-capacity'; capacity: number }
}

export type CoreDispatchRequest =
	| {
			type: 'agent-run-model-turn'
			agentRunId: Id
			coordinationClaims: DispatchCoordinationClaim[]
			reason: { type: 'input-appended'; inputEventId: Id }
	  }
	| {
			type: 'agent-run-preparation'
			agentRunId: Id
			coordinationClaims: DispatchCoordinationClaim[]
			reason: { type: 'agent-run-created' } | { type: 'runtime-requirement-override-added'; eventId: Id }
	  }
	| {
			type: 'agent-run-sandbox-release'
			agentRunId: Id
			coordinationClaims: DispatchCoordinationClaim[]
			reason: { type: '01k00000000000000000100019' }
	  }
	| {
			type: 'delivery-work-scheduler'
			deliveryId: Id
			coordinationClaims: DispatchCoordinationClaim[]
			reason: { type: 'delivery-work-requested' }
	  }
	| {
			type: 'delivery-work-operation'
			deliveryId: Id
			coordinationClaims: DispatchCoordinationClaim[]
			queuedActionId: Id
			operation: DeliveryWorkOperation
			reason: { type: 'delivery-work-operation-queued'; queuedActionId: Id }
	  }

export const sandboxCommandOutputPipe = v.object({
	exitCode: nonNegativeIntegerPipe,
	summary: nonEmptyTrimmedStringPipe,
	stdout: v.nullable(freeFormStringPipe),
	stderr: v.nullable(freeFormStringPipe),
})
export type SandboxCommandOutput = PipeOutput<typeof sandboxCommandOutputPipe>

export const sandboxReleaseOutputPipe = v.object({ summary: nonEmptyTrimmedStringPipe })
export type SandboxReleaseOutput = PipeOutput<typeof sandboxReleaseOutputPipe>

export interface RawSandboxRunCommandInput {
	command: { executable: string; args: string[]; cwd: string }
	env: Record<string, string>
	root: boolean
	timeoutMs: number
}

export interface RawSandbox {
	runCommand(input: RawSandboxRunCommandInput): Promise<unknown>
	readFile(path: string): Promise<unknown>
	writeFile(path: string, contents: string): Promise<unknown>
	release(): Promise<unknown>
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
	release: typedFunctionDependencyPipe<RawSandbox['release']>(),
})
export type RawSandboxOutput = PipeOutput<typeof rawSandboxPipe>

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
	kind: v.eq('consumer-managed'),
	create: typedFunctionDependencyPipe<ConsumerManagedSandboxProvider['create']>(),
	find: typedFunctionDependencyPipe<ConsumerManagedSandboxProvider['find']>(),
})
export type CoreSandboxService = ConsumerManagedSandboxProvider

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
