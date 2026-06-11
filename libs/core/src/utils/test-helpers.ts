import type { Action } from '../domain/action'
import type { AgentRun } from '../domain/agent-run'
import type { DeliveryArtifact, SliceArtifact } from '../domain/artifact'
import type { AuditStamp, Id, OperationContext } from '../domain/commons'
import type { PortfolioConfigRecord } from '../domain/config'
import type { Delivery } from '../domain/delivery'
import type { ExternalOperation, ExternalOperationEvidence, ValidationEvidence, ValidationOperation } from '../domain/evidence'
import type { Link } from '../domain/graph'
import type { Memory } from '../domain/memory'
import type { Model } from '../domain/model'
import type { ModelProvider } from '../domain/model-provider'
import type { Plan } from '../domain/plan'
import type { Project } from '../domain/project'
import type { Repository } from '../domain/repository'
import type { ReviewSurface } from '../domain/review-surface'
import type { Revision, RevisionGate } from '../domain/revision'
import type { Secret, SecretBinding } from '../domain/secret'
import type { Slice } from '../domain/slice'
import type { CoreStorageService, CoreStorageTransaction, OpenCoreOptions, RepositoryTable, SingletonRepository } from '../services'

export const stamp: AuditStamp = { origin: 'imported', at: '2026-06-01T00:00:00.000Z' }
export const context: OperationContext = {
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

export function createTestOpenCoreOptions(): OpenCoreOptions & { tx: MemoryStorageTransaction; transactionCalls: () => number } {
	const storage = createMemoryStorage()
	const idCounters = new Map<string, number>()

	return {
		storage: storage.service,
		secrets: {
			preflight: () => Promise.resolve({ ok: true }),
			resolveSecrets: () => Promise.resolve([]),
			resolveSecretValues: () => Promise.resolve([]),
		},
		sandbox: { preflight: () => Promise.resolve({ ok: true }) },
		clock: { now: () => new Date('2026-06-10T12:00:00.000Z') },
		idGenerator: {
			next: (brand: string) => {
				const next = (idCounters.get(brand) ?? 0) + 1
				idCounters.set(brand, next)

				return `${brand}-${next}`
			},
		},
		tx: storage.tx,
		transactionCalls: () => storage.transactionCalls,
	}
}

export function seedProject(tx: MemoryStorageTransaction, id: string) {
	tx.projects.records.set(id, {
		id,
		title: 'Project',
		source: { type: 'source-control' },
		config: null,
		created: stamp,
	})
}

export function seedDelivery(tx: MemoryStorageTransaction, id: string) {
	tx.deliveries.records.set(id, {
		id,
		projectId: 'project-1',
		planId: 'plan-1',
		title: 'Delivery',
		target: { type: 'source-control', repositoryId: 'repository-1', targetBranch: 'main' },
		config: null,
		accepted: stamp,
	})
}

export function seedSlice(tx: MemoryStorageTransaction, id: string, deliveryId: string, order = nextSliceOrder(tx, deliveryId)) {
	tx.slices.records.set(id, {
		id,
		deliveryId,
		order,
		title: 'Slice',
		instruction: { body: 'Do work.' },
		accepted: stamp,
	})
}

function nextSliceOrder(tx: MemoryStorageTransaction, deliveryId: string): number {
	return [...tx.slices.records.values()].filter((slice) => slice.deliveryId === deliveryId).length
}

export function seedSelectableModel(
	tx: MemoryStorageTransaction,
	id: string,
	options: { modelArchived?: boolean; providerArchived?: boolean } = {},
) {
	const providerId = `${id}-provider`
	tx.modelProviders.records.set(providerId, {
		id: providerId,
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
		id,
		providerId,
		name: 'Model',
		providerModelId: 'model',
		created: stamp,
		updated: null,
		archivePeriods: options.modelArchived ? [{ archived: stamp, unarchived: null }] : [],
	})
}

export function seedSecret(tx: MemoryStorageTransaction, id: string, archived = false) {
	tx.secrets.records.set(id, {
		id,
		name: 'Secret',
		valueRef: 'protected-ref',
		created: stamp,
		replaced: null,
		archivePeriods: archived ? [{ archived: stamp, unarchived: null }] : [],
	})
}

function createMemoryStorage() {
	let transactionCalls = 0
	const tx: MemoryStorageTransaction = {
		portfolioConfig: new MemorySingleton<PortfolioConfigRecord>(),
		projects: new MemoryTable<Project>(),
		repositories: new MemoryTable<Repository>(),
		modelProviders: new MemoryTable<ModelProvider>(),
		models: new MemoryTable<Model>(),
		plans: new MemoryTable<Plan>(),
		deliveries: new MemoryTable<Delivery>(),
		slices: new MemoryTable<Slice>(),
		links: new MemoryTable<Link>(),
		memories: new MemoryTable<Memory>(),
		deliveryArtifacts: new MemoryTable<DeliveryArtifact>(),
		sliceArtifacts: new MemoryTable<SliceArtifact>(),
		actions: new MemoryTable<Action>(),
		agentRuns: new MemoryTable<AgentRun>(),
		reviewSurfaces: new MemoryTable<ReviewSurface>(),
		revisionGates: new MemoryTable<RevisionGate>(),
		revisions: new MemoryTable<Revision>(),
		secrets: new MemoryTable<Secret>(),
		secretBindings: new MemoryTable<SecretBinding>(),
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

export type MemoryStorageTransaction = CoreStorageTransaction & {
	portfolioConfig: MemorySingleton<PortfolioConfigRecord>
	projects: MemoryTable<Project>
	repositories: MemoryTable<Repository>
	modelProviders: MemoryTable<ModelProvider>
	models: MemoryTable<Model>
	plans: MemoryTable<Plan>
	deliveries: MemoryTable<Delivery>
	slices: MemoryTable<Slice>
	links: MemoryTable<Link>
	deliveryArtifacts: MemoryTable<DeliveryArtifact>
	sliceArtifacts: MemoryTable<SliceArtifact>
	actions: MemoryTable<Action>
	agentRuns: MemoryTable<AgentRun>
	reviewSurfaces: MemoryTable<ReviewSurface>
	revisionGates: MemoryTable<RevisionGate>
	revisions: MemoryTable<Revision>
	secrets: MemoryTable<Secret>
	secretBindings: MemoryTable<SecretBinding>
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

class MemoryTable<T extends { id: Id }> implements RepositoryTable<T> {
	records = new Map<Id, T>()
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
