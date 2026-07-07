import { Repo } from 'equipped/orm'
import { InMemoryAdapter } from 'equipped/orm/adapters/in-memory'

import type { CoreRuntimeValues } from './runtime-values'
import type { CommandContext } from '../commands/types'
import type { Action } from '../domain/action'
import type { AgentRun, AgentRunEvent, AgentRunProfileSnapshot } from '../domain/agent-run'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import type { AgentRunRuntimeRequirement, AgentRunSandboxConfig } from '../domain/agent-run-runtime'
import type { DeliveryArtifact, SliceArtifact } from '../domain/artifact'
import type { AuditStamp, Id } from '../domain/commons'
import type { DeliveryWorkConfig } from '../domain/config'
import type { Delivery } from '../domain/delivery'
import type { ExternalOperation, ExternalOperationEvidence, ValidationEvidence, ValidationOperation } from '../domain/evidence'
import type { Link } from '../domain/graph'
import type { Memory, MemoryRevision } from '../domain/memory'
import { defaultModelCapabilities, type Model } from '../domain/model'
import type { ModelProvider } from '../domain/model-provider'
import type { Plan } from '../domain/plan'
import type { Project } from '../domain/project'
import type { Repository } from '../domain/repository'
import type { ReviewSurface } from '../domain/review-surface'
import type { Revision, RevisionGate } from '../domain/revision'
import type { Secret } from '../domain/secret'
import type { Slice } from '../domain/slice'
import { createCoreProviders } from '../providers'
import type { CoreRuntime } from '../runtime'
import type { CoreServices, CoreStorage } from '../services'
import {
	actionSchema,
	agentRunEventSchema,
	agentRunProfileSchema,
	agentRunSchema,
	deliveryArtifactSchema,
	deliverySchema,
	linkSchema,
	memoryRevisionSchema,
	memorySchema,
	modelProviderSchema,
	modelSchema,
	planSchema,
	projectSchema,
	repositorySchema,
	reviewSurfaceSchema,
	revisionGateSchema,
	revisionSchema,
	secretSchema,
	sliceArtifactSchema,
	sliceSchema,
} from '../storage/schemas'

export const stamp: AuditStamp = { origin: 'imported', at: '2026-06-01T00:00:00.000Z' }
export const context: CommandContext = {
	actor: { type: 'local-user', id: 'actor-1' },
	correlationId: 'correlation-1',
}

export function localStamp(): AuditStamp {
	return { origin: 'local', at: '2026-06-10T12:00:00.000Z', actor: context.actor, correlationId: 'correlation-1' }
}

export function validationEvidence(operation: ValidationOperation['type'], passed: boolean, summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: operation }, passed, summary }
}

export function externalOperationEvidence(
	operation: ExternalOperation['type'],
	passed: boolean,
	summary: string,
): ExternalOperationEvidence {
	return { type: 'external-operation', operation: { type: operation }, passed, summary }
}

export function createTestCoreRuntime(
	services = createTestCoreServices(),
	overrides: { providers?: CoreRuntime['providers']; agentRuns?: CoreRuntime['agentRuns']; values?: CoreRuntimeValues } = {},
): CoreRuntime {
	return {
		services,
		providers: overrides.providers ?? createCoreProviders(services),
		agentRuns: overrides.agentRuns ?? {
			runExecutionAgentRun: () => Promise.resolve(),
			runModelAgentRun: () => Promise.resolve({ ok: true, value: undefined }),
		},
		values: overrides.values ?? services.values,
	}
}

export function passingProviderBackedPreflightProviders(): CoreRuntime['providers'] {
	return {
		sourceControl: {
			preflightRepository: () =>
				Promise.resolve({ ok: true, value: { type: 'passed', summary: 'GitHub repository preflight passed.' } }),
			createArtifactBranch: () => Promise.resolve({ ok: true, value: { type: 'passed', mode: 'created', summary: 'created' } }),
			createReviewSurface: () =>
				Promise.resolve({ ok: true, value: { type: 'review-surface', mode: 'created', pullRequestNumber: 1, summary: 'created' } }),
		},
		modelProviderProtocols: {
			preflightModel: () =>
				Promise.resolve({ ok: true, value: { type: 'passed', summary: 'Anthropic Messages model preflight passed.' } }),
			resolveLanguageModel: () => Promise.resolve({ ok: true, value: { type: 'runtime-error' } }),
		},
	}
}

export function failingProviderBackedPreflightProviders(): CoreRuntime['providers'] {
	return {
		sourceControl: {
			preflightRepository: () =>
				Promise.resolve({
					ok: true,
					value: {
						type: 'failed',
						reason: { type: 'provider-repository-not-found' },
						summary: 'GitHub repository was not found.',
					},
				}),
			createArtifactBranch: () => Promise.resolve({ ok: true, value: { type: 'passed', mode: 'created', summary: 'created' } }),
			createReviewSurface: () =>
				Promise.resolve({ ok: true, value: { type: 'review-surface', mode: 'created', pullRequestNumber: 1, summary: 'created' } }),
		},
		modelProviderProtocols: {
			preflightModel: () =>
				Promise.resolve({
					ok: true,
					value: {
						type: 'failed',
						reason: { type: 'provider-model-not-found' },
						summary: 'Anthropic Messages model was not found.',
					},
				}),
			resolveLanguageModel: () => Promise.resolve({ ok: true, value: { type: 'provider-generation-failed' } }),
		},
	}
}

export function neverCalledProviderBackedPreflightProviders(): CoreRuntime['providers'] {
	return {
		sourceControl: {
			preflightRepository: () => Promise.reject(new Error('Source control should not be called.')),
			createArtifactBranch: () => Promise.reject(new Error('Source control should not be called.')),
			createReviewSurface: () => Promise.reject(new Error('Source control should not be called.')),
		},
		modelProviderProtocols: {
			preflightModel: () => Promise.reject(new Error('Model provider should not be called.')),
			resolveLanguageModel: () => Promise.reject(new Error('Model provider should not be called.')),
		},
	}
}

export function createTestCoreServices(overrides: Partial<Pick<CoreServices, 'dispatcher' | 'sandbox' | 'secrets'>> = {}): CoreServices & {
	tx: TestStorageTransaction
	values: CoreRuntimeValues
	transactionCalls: () => number
} {
	const storage = createTestCoreStorageWithView()
	const values = deterministicRuntimeValues()

	return {
		storage: storage.service,
		secrets: overrides.secrets ?? {
			preflight: () => Promise.resolve({ ok: true }),
			resolveSecrets: () => Promise.resolve([]),
			resolveSecretValues: () => Promise.resolve({}),
		},
		sandbox: overrides.sandbox ?? noopSandbox,
		dispatcher: overrides.dispatcher ?? noopDispatcher,
		values,
		tx: storage.tx,
		transactionCalls: () => storage.transactionCalls,
	}
}

const noopSandbox: CoreServices['sandbox'] = {
	kind: 'consumer-managed',
	create: () => Promise.resolve(noopSandboxInstance()),
	find: () => Promise.resolve(noopSandboxInstance()),
}

function noopSandboxInstance() {
	return {
		runCommand: () => Promise.resolve({ exitCode: 0, summary: 'Command succeeded.', stdout: null, stderr: null }),
		readFile: () => Promise.resolve(null),
		writeFile: () => Promise.resolve(),
		release: () => Promise.resolve({ summary: 'Sandbox released.' }),
	}
}

const noopDispatcher: CoreServices['dispatcher'] = {
	preflight: () => Promise.resolve({ ok: true }),
	request: () => Promise.resolve('dispatch-marker'),
	ready: () => {},
}

export function createTestCoreStorage(): CoreStorage {
	return createTestCoreStorageWithView().service
}

export function seedProject(tx: TestStorageTransaction, id: string, work: DeliveryWorkConfig = defaultDeliveryWorkConfig()) {
	tx.projects.records.set(id, {
		id,
		title: 'Project',
		source: { type: 'source-control' },
		config: { configured: stamp, value: { work } },
		created: stamp,
	})
}

export function seedDelivery(tx: TestStorageTransaction, id: string) {
	if (!tx.projects.records.has('01k00000000000000000000030')) seedProject(tx, '01k00000000000000000000030')
	if (!tx.repositories.records.has('01k00000000000000000000034')) {
		tx.repositories.records.set('01k00000000000000000000034', {
			id: '01k00000000000000000000034',
			projectId: '01k00000000000000000000030',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: '01k00000000000000000000040' },
			created: stamp,
		})
	}

	tx.deliveries.records.set(id, {
		id,
		projectId: '01k00000000000000000000030',
		planId: '01k00000000000000000000028',
		title: 'Delivery',
		target: { type: 'source-control', repositoryId: '01k00000000000000000000034', targetBranch: 'main' },
		config: null,
		accepted: stamp,
		queued: null,
		closed: null,
	})
}

export function seedSlice(tx: TestStorageTransaction, id: string, deliveryId: string, order = nextSliceOrder(tx, deliveryId)) {
	tx.slices.records.set(id, {
		id,
		deliveryId,
		order,
		title: 'Slice',
		instruction: { body: 'Do work.' },
		accepted: stamp,
	})
}

export function seedAction(
	tx: TestStorageTransaction,
	id: string,
	at: string,
	result: Action['result'],
	authorized: AuditStamp | null = localStamp(),
) {
	tx.actions.records.set(id, { id, deliveryId: '01k00000000000000000000008', performed: { at }, authorized, result })
}

export function defaultAgentRunSandboxConfig(): AgentRunSandboxConfig {
	return {
		source: { type: 'consumer-managed', ociImage: 'alpine:latest' },
		resources: { vcpus: 2 },
		networkPolicy: { type: 'allow-all' },
	}
}

export function testAgentRunProfileSnapshot(
	agentRunProfileId = '01k00000000000000000000006',
	modelId = '01k00000000000000000000024',
	runtimeRequirements: AgentRunRuntimeRequirement[] = [],
	sandboxConfig: AgentRunSandboxConfig = defaultAgentRunSandboxConfig(),
): AgentRunProfileSnapshot {
	return {
		agentRunProfileId,
		name: 'Agent Run Profile',
		modelUse: { modelId, thinkingLevel: 'none' },
		runtimeRequirements,
		sandboxConfig,
	}
}

export function testModelAgentRun(
	input: {
		id?: string
		purpose?: AgentRun['purpose']
		profile?: AgentRunProfileSnapshot
		completed?: AgentRun['completed']
	} = {},
): AgentRun {
	return {
		id: input.id ?? '01k00000000000000000000002',
		agent: { type: 'model' },
		purpose: input.purpose ?? { type: 'planning', planId: '01k00000000000000000000028' },
		profile: input.profile ?? testAgentRunProfileSnapshot(),
		modelUseOverride: null,
		sourceRuntimeRequirements: [],
		runtimeRequirementOverrides: [],
		desiredRuntimeRequirements: input.profile?.runtimeRequirements ?? [],
		blocked: { type: 'sandbox-preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
		sandbox: {
			key: input.id ?? '01k00000000000000000000002',
			created: null,
			appliedRequirements: [],
			appliedThroughEventId: null,
			released: null,
		},
		started: { at: '2026-06-10T12:00:00.000Z' },
		completed: input.completed ?? null,
	}
}

function nextSliceOrder(tx: TestStorageTransaction, deliveryId: string): number {
	return [...tx.slices.records.values()].filter((slice) => slice.deliveryId === deliveryId).length
}

export function seedModelProvider(tx: TestStorageTransaction, id: string, archived = false) {
	tx.modelProviders.records.set(id, {
		id,
		name: 'Provider',
		source: { type: 'anthropic' },
		auth: null,
		headers: [],
		providerOptions: null,
		created: stamp,
		updated: null,
		archivePeriods: archived ? [{ archived: stamp, unarchived: null }] : [],
	})
}

export function seedSelectableModel(
	tx: TestStorageTransaction,
	id: string,
	options: { modelArchived?: boolean; providerArchived?: boolean; providerId?: string } = {},
) {
	const providerId = options.providerId ?? nextTestId(id)
	seedModelProvider(tx, providerId, options.providerArchived)
	tx.models.records.set(id, {
		id,
		providerId,
		name: 'Model',
		providerModelId: 'model',
		providerOptions: null,
		capabilities: defaultModelCapabilities,
		pricing: null,
		created: stamp,
		updated: null,
		archivePeriods: options.modelArchived ? [{ archived: stamp, unarchived: null }] : [],
	})
}

function nextTestId(id: string): string {
	const sequence = Number(id.slice(-5))
	return Number.isSafeInteger(sequence) ? testId(50_000 + sequence) : testId(99999)
}

export function seedAgentRunProfile(
	tx: TestStorageTransaction,
	id: string,
	modelId = '01k00000000000000000000024',
	options: { archived?: boolean; runtimeRequirements?: AgentRunRuntimeRequirement[] } = {},
): AgentRunProfile {
	if (!tx.models.records.has(modelId)) seedSelectableModel(tx, modelId)
	const profile: AgentRunProfile = {
		id,
		name: 'Agent Run Profile',
		modelUse: { modelId, thinkingLevel: 'none' },
		runtimeRequirements: options.runtimeRequirements ?? [],
		sandboxConfig: defaultAgentRunSandboxConfig(),
		created: stamp,
		updated: null,
		archivePeriods: options.archived ? [{ archived: stamp, unarchived: null }] : [],
	}
	tx.agentRunProfiles.records.set(id, profile)
	return profile
}

export function defaultDeliveryWorkConfig(agentRunProfileId = testId(6)): DeliveryWorkConfig {
	return {
		maxProcessableSliceSlots: 1,
		maxCorrectionRetriesPerFailure: 1,
		executionAgentRunProfileId: agentRunProfileId,
		revisionExecutionAgentRunProfileId: null,
	}
}

export function seedSecret(tx: TestStorageTransaction, id: string, archived = false) {
	tx.secrets.records.set(id, {
		id,
		name: 'Secret',
		valueRef: 'protected-ref',
		created: stamp,
		replaced: null,
		archivePeriods: archived ? [{ archived: stamp, unarchived: null }] : [],
	})
}

export function testId(sequence: number): string {
	return `01k000000000000000000${sequence.toString().padStart(5, '0')}`
}

function deterministicRuntimeValues(): CoreRuntimeValues {
	let idCounter = 10000
	return {
		now: () => new Date('2026-06-10T12:00:00.000Z'),
		nextId: () => testId(++idCounter),
	}
}

function createTestCoreStorageWithView() {
	let transactionCalls = 0
	const adapter = InMemoryAdapter.create({})
	const tx = testStorageTransaction(adapter)
	patchAdapterFailures(adapter, tx, () => {
		transactionCalls += 1
	})
	const service = Repo.from(adapter)
		.resolve((schema) => ({ table: schema.name }))
		.build() as CoreStorage
	attachStorageSurface(tx, service)

	return {
		service,
		tx,
		get transactionCalls() {
			return transactionCalls
		},
	}
}

export interface TestStorageTransaction extends CoreStorage {
	projects: TestTable<Project>
	repositories: TestTable<Repository>
	modelProviders: TestTable<ModelProvider>
	models: TestTable<Model>
	agentRunProfiles: TestTable<AgentRunProfile>
	plans: TestTable<Plan>
	deliveries: TestTable<Delivery>
	slices: TestTable<Slice>
	links: TestTable<Link>
	memories: TestTable<Memory>
	memoryRevisions: TestTable<MemoryRevision>
	deliveryArtifacts: TestTable<DeliveryArtifact>
	sliceArtifacts: TestTable<SliceArtifact>
	actions: TestTable<Action>
	agentRuns: TestTable<AgentRun>
	agentRunEvents: TestTable<AgentRunEvent>
	reviewSurfaces: TestTable<ReviewSurface>
	revisionGates: TestTable<RevisionGate>
	revisions: TestTable<Revision>
	secrets: TestTable<Secret>
}

export interface TestTable<TRecord extends { id: Id }> {
	records: Map<Id, TRecord>
	fail: { get: boolean; put: boolean; list: boolean }
}

function testStorageTransaction(adapter: InMemoryAdapter): TestStorageTransaction {
	return {
		projects: tableView<Project>(adapter, projectSchema.name),
		repositories: tableView<Repository>(adapter, repositorySchema.name),
		modelProviders: tableView<ModelProvider>(adapter, modelProviderSchema.name),
		models: tableView<Model>(adapter, modelSchema.name),
		agentRunProfiles: tableView<AgentRunProfile>(adapter, agentRunProfileSchema.name),
		plans: tableView<Plan>(adapter, planSchema.name),
		deliveries: tableView<Delivery>(adapter, deliverySchema.name),
		slices: tableView<Slice>(adapter, sliceSchema.name),
		links: tableView<Link>(adapter, linkSchema.name),
		memories: tableView<Memory>(adapter, memorySchema.name),
		memoryRevisions: tableView<MemoryRevision>(adapter, memoryRevisionSchema.name),
		deliveryArtifacts: tableView<DeliveryArtifact>(adapter, deliveryArtifactSchema.name),
		sliceArtifacts: tableView<SliceArtifact>(adapter, sliceArtifactSchema.name),
		actions: tableView<Action>(adapter, actionSchema.name),
		agentRuns: tableView<AgentRun>(adapter, agentRunSchema.name),
		agentRunEvents: tableView<AgentRunEvent>(adapter, agentRunEventSchema.name),
		reviewSurfaces: tableView<ReviewSurface>(adapter, reviewSurfaceSchema.name),
		revisionGates: tableView<RevisionGate>(adapter, revisionGateSchema.name),
		revisions: tableView<Revision>(adapter, revisionSchema.name),
		secrets: tableView<Secret>(adapter, secretSchema.name),
	} as TestStorageTransaction
}

function attachStorageSurface(tx: TestStorageTransaction, storage: CoreStorage): void {
	tx.on = storage.on.bind(storage)
	tx.session = storage.session.bind(storage)
	tx.resolve = storage.resolve.bind(storage)
}

function tableView<TRecord extends { id: Id }>(adapter: InMemoryAdapter, table: string): TestTable<TRecord> {
	return {
		get records() {
			return store(adapter, table) as Map<Id, TRecord>
		},
		fail: { get: false, put: false, list: false },
	}
}

function store(adapter: InMemoryAdapter, table: string): Map<string, Record<string, unknown>> {
	let records = adapter.stores.get(table)
	if (records === undefined) {
		records = new Map()
		adapter.stores.set(table, records)
	}

	return records
}

function patchAdapterFailures(adapter: InMemoryAdapter, tx: TestStorageTransaction, onSession: () => void): void {
	const tables = failureTables(tx)
	const findByPk = adapter.findByPk.bind(adapter)
	adapter.findByPk = (schema, config, pk) => {
		if (failuresForConfig(tables, config)?.get === true) throw new Error('get failed')
		return findByPk(schema, config, pk)
	}

	const findMany = adapter.findMany.bind(adapter)
	adapter.findMany = (schema, config, group, options) => {
		if (failuresForConfig(tables, config)?.list === true) throw new Error('list failed')
		return findMany(schema, config, group, options)
	}

	const createMany = adapter.createMany.bind(adapter)
	adapter.createMany = (schema, config, data) => {
		if (failuresForConfig(tables, config)?.put === true) throw new Error('put failed')
		return createMany(schema, config, data)
	}

	const updateByPk = adapter.updateByPk.bind(adapter)
	adapter.updateByPk = (schema, config, pk, ops) => {
		if (failuresForConfig(tables, config)?.put === true) throw new Error('put failed')
		return updateByPk(schema, config, pk, ops)
	}

	const updateMany = adapter.updateMany.bind(adapter)
	adapter.updateMany = (schema, config, group, data) => {
		if (failuresForConfig(tables, config)?.put === true) throw new Error('put failed')
		return updateMany(schema, config, group, data)
	}

	const session = adapter.session.bind(adapter)
	adapter.session = (fn) => {
		onSession()
		return session(fn)
	}
}

function failureTables(tx: TestStorageTransaction): Map<string, { get?: boolean; put?: boolean; list?: boolean }> {
	return new Map([
		[projectSchema.name, tx.projects.fail],
		[repositorySchema.name, tx.repositories.fail],
		[modelProviderSchema.name, tx.modelProviders.fail],
		[modelSchema.name, tx.models.fail],
		[agentRunProfileSchema.name, tx.agentRunProfiles.fail],
		[planSchema.name, tx.plans.fail],
		[deliverySchema.name, tx.deliveries.fail],
		[sliceSchema.name, tx.slices.fail],
		[linkSchema.name, tx.links.fail],
		[memorySchema.name, tx.memories.fail],
		[memoryRevisionSchema.name, tx.memoryRevisions.fail],
		[deliveryArtifactSchema.name, tx.deliveryArtifacts.fail],
		[sliceArtifactSchema.name, tx.sliceArtifacts.fail],
		[actionSchema.name, tx.actions.fail],
		[agentRunSchema.name, tx.agentRuns.fail],
		[agentRunEventSchema.name, tx.agentRunEvents.fail],
		[reviewSurfaceSchema.name, tx.reviewSurfaces.fail],
		[revisionGateSchema.name, tx.revisionGates.fail],
		[revisionSchema.name, tx.revisions.fail],
		[secretSchema.name, tx.secrets.fail],
	])
}

function failuresForConfig(
	tables: Map<string, { get?: boolean; put?: boolean; list?: boolean }>,
	config: unknown,
): { get?: boolean; put?: boolean; list?: boolean } | undefined {
	return typeof config === 'object' && config !== null && typeof (config as { table?: unknown }).table === 'string'
		? tables.get((config as { table: string }).table)
		: undefined
}
