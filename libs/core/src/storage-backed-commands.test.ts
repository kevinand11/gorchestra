import { describe, expect, it } from 'vitest'

import { openCore, type CoreSandboxService, type CoreSecretsService, type CoreStorageService, type CoreStorageTransaction } from './api'
import type {
	Action,
	ActionId,
	AgentRun,
	AgentRunId,
	AuditStamp,
	Delivery,
	DeliveryArtifact,
	DeliveryArtifactId,
	DeliveryId,
	Link,
	LinkId,
	Memory,
	MemoryId,
	Model,
	ModelId,
	ModelProvider,
	ModelProviderId,
	Plan,
	PlanId,
	PortfolioConfigRecord,
	Project,
	ProjectId,
	Repository,
	RepositoryId,
	ReviewSurface,
	ReviewSurfaceId,
	Revision,
	RevisionGate,
	RevisionGateId,
	RevisionId,
	Secret,
	SecretBinding,
	SecretBindingId,
	SecretId,
	Slice,
	SliceArtifact,
	SliceArtifactId,
	SliceId,
} from './model'
import type { RepositoryTable, SingletonRepository } from './services'

const stamp: AuditStamp = { origin: 'imported', at: '2026-06-01T00:00:00.000Z' }
const context = {
	actor: { type: 'local-user', id: 'actor-1' },
	correlationId: 'correlation-1',
}

const secrets: CoreSecretsService = {
	preflight: () => Promise.resolve({ ok: true }),
	resolveSecrets: () => Promise.resolve([]),
	resolveSecretValues: () => Promise.resolve([]),
}

const sandbox: CoreSandboxService = {
	preflight: () => Promise.resolve({ ok: true }),
}

describe('storage-backed setup commands', () => {
	it('sets Portfolio config with normalized config and selectable Model validation', async () => {
		const storage = createMemoryStorage()
		seedSelectableModel(storage.tx, 'model-1')
		const core = openTestCore(storage.service)

		const result = await core.commands.setPortfolioConfig(
			{
				config: {
					model: {
						defaultModelId: ' model-1 ' as ModelId,
						planningModelId: null,
						revisionPlanningModelId: 'model-1' as ModelId,
						executionModelId: null,
						revisionExecutionModelId: null,
					},
					work: { maxActiveSliceSlots: 2, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
				},
			},
			context,
		)

		expect(result).toEqual({
			ok: true,
			value: {
				configured: localStamp(),
				value: {
					model: {
						defaultModelId: 'model-1',
						planningModelId: null,
						revisionPlanningModelId: 'model-1',
						executionModelId: null,
						revisionExecutionModelId: null,
					},
					work: { maxActiveSliceSlots: 2, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
				},
			},
		})
		expect(storage.tx.portfolioConfig.record).toEqual(result.ok ? result.value : null)
		expect(storage.transactionCalls).toBe(1)
	})

	it('rejects config Model references that are unavailable for selection', async () => {
		const storage = createMemoryStorage()
		seedSelectableModel(storage.tx, 'model-1', { modelArchived: true })
		const core = openTestCore(storage.service)

		const result = await core.commands.setPortfolioConfig(
			{
				config: {
					model: {
						defaultModelId: 'model-1' as ModelId,
						planningModelId: null,
						revisionPlanningModelId: null,
						executionModelId: null,
						revisionExecutionModelId: null,
					},
					work: null,
				},
			},
			context,
		)

		expect(result).toEqual({ ok: false, error: { type: 'model-not-selectable', modelId: 'model-1', reason: 'model-archived' } })
		expect(storage.tx.portfolioConfig.record).toBeNull()
	})

	it('creates Projects with normalized titles, immutable source, folded create config, and Audit Stamps', async () => {
		const storage = createMemoryStorage()
		const core = openTestCore(storage.service)

		const result = await core.commands.createProject(
			{
				title: '  Build Gorchestra  ',
				source: { type: 'source-control' },
				config: {
					model: {
						planningModelId: null,
						revisionPlanningModelId: null,
						executionModelId: null,
						revisionExecutionModelId: null,
					},
					work: null,
				},
			},
			context,
		)

		expect(result).toEqual({
			ok: true,
			value: {
				id: 'project-1',
				title: 'Build Gorchestra',
				source: { type: 'source-control' },
				config: null,
				created: localStamp(),
			},
		})
		expect(storage.tx.projects.records.get('project-1')).toEqual(result.ok ? result.value : null)
	})

	it('sets Project config as a retained config record that can fold to null', async () => {
		const storage = createMemoryStorage()
		seedProject(storage.tx, 'project-1')
		const core = openTestCore(storage.service)

		const result = await core.commands.setProjectConfig(
			{
				projectId: 'project-1' as ProjectId,
				config: { model: null, work: null },
			},
			context,
		)

		expect(result).toEqual({
			ok: true,
			value: {
				id: 'project-1',
				title: 'Project',
				source: { type: 'source-control' },
				config: { configured: localStamp(), value: null },
				created: stamp,
			},
		})
		expect(storage.tx.projects.records.get('project-1')?.config).toEqual({ configured: localStamp(), value: null })
	})

	it('creates and updates Repositories only for Source Control Projects with active Secret references', async () => {
		const storage = createMemoryStorage()
		seedProject(storage.tx, 'project-1')
		seedSecret(storage.tx, 'secret-1')
		const core = openTestCore(storage.service)

		const created = await core.commands.createRepository(
			{
				projectId: 'project-1' as ProjectId,
				config: { provider: 'github', owner: ' Octo ', name: ' Repo ', secretId: 'secret-1' as SecretId },
			},
			context,
		)
		expect(created).toEqual({
			ok: true,
			value: {
				id: 'repository-1',
				projectId: 'project-1',
				config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
				created: localStamp(),
			},
		})

		seedSecret(storage.tx, 'secret-2')
		const updated = await core.commands.updateRepositoryConfig(
			{
				repositoryId: 'repository-1' as RepositoryId,
				config: { provider: 'github', owner: 'Octo', name: 'Renamed', secretId: 'secret-2' as SecretId },
			},
			context,
		)
		expect(updated).toEqual({
			ok: true,
			value: {
				id: 'repository-1',
				projectId: 'project-1',
				config: { provider: 'github', owner: 'Octo', name: 'Renamed', secretId: 'secret-2' },
				created: localStamp(),
			},
		})
	})

	it('rejects duplicate Repository targets in the same Project case-insensitively after normalization', async () => {
		const storage = createMemoryStorage()
		seedProject(storage.tx, 'project-1')
		seedSecret(storage.tx, 'secret-1')
		storage.tx.repositories.records.set('repository-existing', {
			id: 'repository-existing' as RepositoryId,
			projectId: 'project-1' as ProjectId,
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' as SecretId },
			created: stamp,
		})
		const core = openTestCore(storage.service)

		const result = await core.commands.createRepository(
			{
				projectId: 'project-1' as ProjectId,
				config: { provider: 'github', owner: ' octo ', name: ' repo ', secretId: 'secret-1' as SecretId },
			},
			context,
		)

		expect(result).toEqual({
			ok: false,
			error: { type: 'duplicate-repository-target', projectId: 'project-1', provider: 'github', owner: 'octo', name: 'repo' },
		})
	})

	it('rejects Repository config that references archived Secrets', async () => {
		const storage = createMemoryStorage()
		seedProject(storage.tx, 'project-1')
		seedSecret(storage.tx, 'secret-1', true)
		const core = openTestCore(storage.service)

		const result = await core.commands.createRepository(
			{
				projectId: 'project-1' as ProjectId,
				config: { provider: 'github', owner: 'octo', name: 'repo', secretId: 'secret-1' as SecretId },
			},
			context,
		)

		expect(result).toEqual({ ok: false, error: { type: 'secret-not-active', secretId: 'secret-1' } })
	})

	it('creates Plans for existing Projects without Repository setup unless explicit config references require validation', async () => {
		const storage = createMemoryStorage()
		seedProject(storage.tx, 'project-1')
		const core = openTestCore(storage.service)

		const result = await core.commands.createPlan(
			{
				projectId: 'project-1' as ProjectId,
				title: '  Plan setup  ',
				config: { model: { planningModelId: null } },
			},
			context,
		)

		expect(result).toEqual({
			ok: true,
			value: {
				id: 'plan-1',
				projectId: 'project-1',
				title: 'Plan setup',
				config: null,
				created: localStamp(),
			},
		})
		expect(storage.tx.plans.records.get('plan-1')).toEqual(result.ok ? result.value : null)

		seedSelectableModel(storage.tx, 'model-1', { providerArchived: true })
		const rejected = await core.commands.createPlan(
			{
				projectId: 'project-1' as ProjectId,
				title: 'Needs model',
				config: { model: { planningModelId: 'model-1' as ModelId } },
			},
			context,
		)
		expect(rejected).toEqual({ ok: false, error: { type: 'model-not-selectable', modelId: 'model-1', reason: 'provider-archived' } })
	})

	it('returns storage-operation-failed when storage reads or writes fail', async () => {
		const storage = createMemoryStorage()
		storage.tx.projects.fail.get = true
		const core = openTestCore(storage.service)

		const result = await core.commands.createPlan({ projectId: 'project-1' as ProjectId, title: 'Plan', config: null }, context)

		expect(result).toEqual({
			ok: false,
			error: { type: 'storage-operation-failed', operation: { type: 'get', resource: 'project', id: 'project-1' } },
		})
	})

	it('returns invalid-core-service-output when command runtime services fail', async () => {
		const clockStorage = createMemoryStorage()
		const clockCore = openCore({
			storage: clockStorage.service,
			secrets,
			sandbox,
			clock: {
				now: () => {
					throw new Error('clock failed')
				},
			},
			idGenerator: { next: (brand: string) => `${brand}-1` },
		})
		if (!clockCore.ok) throw new Error('Expected clock core to open')

		const clockResult = await clockCore.value.commands.createProject(
			{ title: 'Project', source: { type: 'source-control' }, config: null },
			context,
		)
		expect(clockResult).toMatchObject({
			ok: false,
			error: { type: 'invalid-core-service-output', service: 'clock', operation: 'now' },
		})
		expect(clockStorage.transactionCalls).toBe(0)

		const idStorage = createMemoryStorage()
		const idCore = openCore({
			storage: idStorage.service,
			secrets,
			sandbox,
			clock: { now: () => new Date('2026-06-10T12:00:00.000Z') },
			idGenerator: {
				next: () => {
					throw new Error('id failed')
				},
			},
		})
		if (!idCore.ok) throw new Error('Expected id core to open')

		const idResult = await idCore.value.commands.createProject(
			{ title: 'Project', source: { type: 'source-control' }, config: null },
			context,
		)
		expect(idResult).toMatchObject({
			ok: false,
			error: { type: 'invalid-core-service-output', service: 'idGenerator', operation: 'next' },
		})
		expect(idStorage.transactionCalls).toBe(0)
	})

	it('returns invalid-core-service-output for malformed storage records read through get', async () => {
		const storage = createMemoryStorage()
		storage.tx.projects.records.set('project-1', { id: 'project-1' } as Project)
		const core = openTestCore(storage.service)

		const result = await core.commands.createPlan({ projectId: 'project-1' as ProjectId, title: 'Plan', config: null }, context)

		expect(result).toMatchObject({
			ok: false,
			error: { type: 'invalid-core-service-output', service: 'storage', operation: 'get:project' },
		})
		expect(storage.tx.plans.records.size).toBe(0)
	})

	it('returns invalid-core-service-output when storage get returns a record with a mismatched id', async () => {
		const storage = createMemoryStorage()
		seedProject(storage.tx, 'project-1')
		const project = storage.tx.projects.records.get('project-1')
		if (project === undefined) throw new Error('Expected seeded project')
		storage.tx.projects.records.set('project-1', { ...project, id: 'project-2' as ProjectId })
		const core = openTestCore(storage.service)

		const result = await core.commands.createPlan({ projectId: 'project-1' as ProjectId, title: 'Plan', config: null }, context)

		expect(result).toMatchObject({
			ok: false,
			error: { type: 'invalid-core-service-output', service: 'storage', operation: 'get:project' },
		})
		expect(storage.tx.plans.records.size).toBe(0)
	})

	it('returns invalid-core-service-output for malformed storage records read through list', async () => {
		const storage = createMemoryStorage()
		seedProject(storage.tx, 'project-1')
		seedSecret(storage.tx, 'secret-1')
		storage.tx.repositories.records.set('repository-malformed', { id: 'repository-malformed' } as Repository)
		const core = openTestCore(storage.service)

		const result = await core.commands.createRepository(
			{
				projectId: 'project-1' as ProjectId,
				config: { provider: 'github', owner: 'octo', name: 'repo', secretId: 'secret-1' as SecretId },
			},
			context,
		)

		expect(result).toMatchObject({
			ok: false,
			error: { type: 'invalid-core-service-output', service: 'storage', operation: 'list:repository' },
		})
		expect(storage.tx.repositories.records.has('repository-1')).toBe(false)
	})
})

function openTestCore(storage: CoreStorageService) {
	const opened = openCore({
		storage,
		secrets,
		sandbox,
		clock: { now: () => new Date('2026-06-10T12:00:00.000Z') },
		idGenerator: { next: (brand: string) => `${brand}-1` },
	})

	if (!opened.ok) {
		throw new Error('Expected test core to open')
	}

	return opened.value
}

function localStamp(): AuditStamp {
	return { origin: 'local', at: '2026-06-10T12:00:00.000Z', actor: context.actor, correlationId: 'correlation-1' }
}

function createMemoryStorage() {
	let transactionCalls = 0
	const tx: MemoryStorageTransaction = {
		portfolioConfig: new MemorySingleton<PortfolioConfigRecord>(),
		projects: new MemoryTable<Project, ProjectId>(),
		repositories: new MemoryTable<Repository, RepositoryId>(),
		modelProviders: new MemoryTable<ModelProvider, ModelProviderId>(),
		models: new MemoryTable<Model, ModelId>(),
		plans: new MemoryTable<Plan, PlanId>(),
		deliveries: new MemoryTable<Delivery, DeliveryId>(),
		slices: new MemoryTable<Slice, SliceId>(),
		links: new MemoryTable<Link, LinkId>(),
		memories: new MemoryTable<Memory, MemoryId>(),
		deliveryArtifacts: new MemoryTable<DeliveryArtifact, DeliveryArtifactId>(),
		sliceArtifacts: new MemoryTable<SliceArtifact, SliceArtifactId>(),
		actions: new MemoryTable<Action, ActionId>(),
		agentRuns: new MemoryTable<AgentRun, AgentRunId>(),
		reviewSurfaces: new MemoryTable<ReviewSurface, ReviewSurfaceId>(),
		revisionGates: new MemoryTable<RevisionGate, RevisionGateId>(),
		revisions: new MemoryTable<Revision, RevisionId>(),
		secrets: new MemoryTable<Secret, SecretId>(),
		secretBindings: new MemoryTable<SecretBinding, SecretBindingId>(),
	}
	const service: CoreStorageService = {
		preflight: () => Promise.resolve({ ok: true }),
		transaction: async <T>(fn: (transaction: CoreStorageTransaction) => Promise<T>): Promise<T> => {
			transactionCalls += 1
			return fn(tx)
		},
	}

	return {
		service,
		tx,
		get transactionCalls() {
			return transactionCalls
		},
	}
}

type MemoryStorageTransaction = CoreStorageTransaction & {
	portfolioConfig: MemorySingleton<PortfolioConfigRecord>
	projects: MemoryTable<Project, ProjectId>
	repositories: MemoryTable<Repository, RepositoryId>
	modelProviders: MemoryTable<ModelProvider, ModelProviderId>
	models: MemoryTable<Model, ModelId>
	plans: MemoryTable<Plan, PlanId>
	secrets: MemoryTable<Secret, SecretId>
}

class MemorySingleton<T> implements SingletonRepository<T> {
	record: T | null = null
	fail = { get: false, put: false }

	get(): Promise<T | null> {
		if (this.fail.get) {
			throw new Error('get failed')
		}

		return Promise.resolve(this.record)
	}

	put(record: T): Promise<void> {
		if (this.fail.put) {
			throw new Error('put failed')
		}

		this.record = record
		return Promise.resolve()
	}
}

class MemoryTable<T extends { id: Id }, Id extends string> implements RepositoryTable<T, Id> {
	records = new Map<string, T>()
	fail = { get: false, put: false, list: false }

	get(id: Id): Promise<T | null> {
		if (this.fail.get) {
			throw new Error('get failed')
		}

		return Promise.resolve(this.records.get(id) ?? null)
	}

	put(record: T): Promise<void> {
		if (this.fail.put) {
			throw new Error('put failed')
		}

		this.records.set(record.id, record)
		return Promise.resolve()
	}

	list(): Promise<T[]> {
		if (this.fail.list) {
			throw new Error('list failed')
		}

		return Promise.resolve([...this.records.values()])
	}
}

function seedProject(tx: MemoryStorageTransaction, id: string) {
	tx.projects.records.set(id, {
		id: id as ProjectId,
		title: 'Project',
		source: { type: 'source-control' },
		config: null,
		created: stamp,
	})
}

function seedSelectableModel(
	tx: MemoryStorageTransaction,
	id: string,
	options: { modelArchived?: boolean; providerArchived?: boolean } = {},
) {
	const providerId = `${id}-provider`
	tx.modelProviders.records.set(providerId, {
		id: providerId as ModelProviderId,
		name: 'Provider',
		protocol: 'anthropic-messages',
		baseUrl: 'https://api.example.com',
		auth: null,
		headers: [],
		created: stamp,
		updated: null,
		archivePeriods: options.providerArchived ? [{ archived: stamp, unarchived: null }] : [],
	})
	tx.models.records.set(id, {
		id: id as ModelId,
		providerId: providerId as ModelProviderId,
		name: 'Model',
		providerModelId: 'model',
		created: stamp,
		updated: null,
		archivePeriods: options.modelArchived ? [{ archived: stamp, unarchived: null }] : [],
	})
}

function seedSecret(tx: MemoryStorageTransaction, id: string, archived = false) {
	tx.secrets.records.set(id, {
		id: id as SecretId,
		name: 'Secret',
		valueRef: 'protected-ref',
		created: stamp,
		replaced: null,
		archivePeriods: archived ? [{ archived: stamp, unarchived: null }] : [],
	})
}
