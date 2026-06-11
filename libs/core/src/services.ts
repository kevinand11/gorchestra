import { v, type PipeOutput } from 'valleyed'

import type { Action } from './domain/action'
import type { AgentRun } from './domain/agent-run'
import type { DeliveryArtifact, SliceArtifact } from './domain/artifact'
import type { Id } from './domain/commons'
import type { PortfolioConfigRecord } from './domain/config'
import type { Delivery } from './domain/delivery'
import type { Link } from './domain/graph'
import type { Memory } from './domain/memory'
import type { Model } from './domain/model'
import type { ModelProvider } from './domain/model-provider'
import type { Plan } from './domain/plan'
import type { Project } from './domain/project'
import type { Repository } from './domain/repository'
import type { ReviewSurface } from './domain/review-surface'
import type { Revision, RevisionGate } from './domain/revision'
import type { Secret, SecretBinding } from './domain/secret'
import type { Slice } from './domain/slice'
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
	clock: CorePreflightCheck
	idGenerator: CorePreflightCheck
}

export type CorePreflightCheck = { ok: true } | { ok: false; reason: 'not-ready' | 'probe-failed'; message: string | null }

export interface CoreStorageTransaction {
	portfolioConfig: SingletonRepository<PortfolioConfigRecord>
	projects: RepositoryTable<Project>
	repositories: RepositoryTable<Repository>
	modelProviders: RepositoryTable<ModelProvider>
	models: RepositoryTable<Model>
	plans: RepositoryTable<Plan>
	deliveries: RepositoryTable<Delivery>
	slices: RepositoryTable<Slice>
	links: RepositoryTable<Link>
	memories: RepositoryTable<Memory>
	deliveryArtifacts: RepositoryTable<DeliveryArtifact>
	sliceArtifacts: RepositoryTable<SliceArtifact>
	actions: RepositoryTable<Action>
	agentRuns: RepositoryTable<AgentRun>
	reviewSurfaces: RepositoryTable<ReviewSurface>
	revisionGates: RepositoryTable<RevisionGate>
	revisions: RepositoryTable<Revision>
	secrets: RepositoryTable<Secret>
	secretBindings: RepositoryTable<SecretBinding>
}

export interface SingletonRepository<T> {
	get(): Promise<T | null>
	put(record: T): Promise<void>
}

export interface RepositoryTable<T> {
	get(id: Id): Promise<T | null>
	put(record: T): Promise<void>
	list(): Promise<T[]>
}

export interface ResolveSecretsInput {
	scope: { type: 'project'; projectId: Id } | { type: 'delivery'; deliveryId: Id }
}

export interface ResolveSecretValuesInput {
	secretIds: Id[]
}

export interface ResolvedSecret {
	secretId: Id
	envName: string

	/** Plaintext exists only transiently. */
	plaintext: string
}

export interface ResolvedSecretValue {
	secretId: Id

	/** Plaintext exists only transiently. */
	plaintext: string
}

export type CoreEvent = never

type PreflightFn = () => Promise<CoreServicePreflightOutput>

export const storagePipe = v.object({
	preflight: typedFunctionDependencyPipe<PreflightFn>(),
	transaction: typedFunctionDependencyPipe<<T>(fn: (tx: CoreStorageTransaction) => Promise<T>) => Promise<T>>(),
})
export type CoreStorageService = PipeOutput<typeof storagePipe>
export type CoreStorage = CoreStorageService

export const coreSecretsServicePipe = v.object({
	preflight: typedFunctionDependencyPipe<PreflightFn>(),
	resolveSecrets: typedFunctionDependencyPipe<(input: ResolveSecretsInput) => Promise<ResolvedSecret[]>>(),
	resolveSecretValues: typedFunctionDependencyPipe<(input: ResolveSecretValuesInput) => Promise<ResolvedSecretValue[]>>(),
})
export type CoreSecretsService = PipeOutput<typeof coreSecretsServicePipe>

export const coreSandboxServicePipe = v.object({
	preflight: typedFunctionDependencyPipe<PreflightFn>(),
})
export type CoreSandboxService = PipeOutput<typeof coreSandboxServicePipe>

const coreClockServicePipe = v.object({
	now: typedFunctionDependencyPipe<() => Date>(),
})
export type CoreClockService = PipeOutput<typeof coreClockServicePipe>

const coreIdGeneratorServicePipe = v.object({
	next: typedFunctionDependencyPipe<<Name extends string>(brand: Name) => string>(),
})
export type CoreIdGeneratorService = PipeOutput<typeof coreIdGeneratorServicePipe>

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
	clock: coreClockServicePipe,
	idGenerator: coreIdGeneratorServicePipe,
	logger: v.optional(coreLoggerPipe),
	eventSink: v.optional(coreEventSinkPipe),
})
export type CoreServices = UndefinedToOptional<PipeOutput<typeof coreServicesPipe>>

function typedFunctionDependencyPipe<Fn extends (...args: never[]) => unknown>() {
	return v.any<Fn>().pipe(v.custom((value) => typeof value === 'function', 'Expected a function dependency.'))
}
