import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRun, AgentRunEvent } from '../domain/agent-run'
import { idPipe, type AuditStamp, type Id } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { Link, LinkDef } from '../domain/graph'
import type { Memory, MemoryRevision } from '../domain/memory'
import type {
	PlanOutputProposal,
	ProposedChildMemoryCreation,
	ProposedDelivery,
	ProposedMemoryCreation,
	ProposedMemoryRevision,
} from '../domain/plan'
import type { Slice } from '../domain/slice'
import type {
	AgentRunPurposeMismatchError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvalidPlanOutputError,
	InvariantViolationError,
	ProposalAlreadyReviewedError,
	ProposalTypeMismatchError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { appendAgentRunEvent } from '../utils/agent-run-events'
import { getPendingProposalForAgentRunPurpose } from '../utils/proposals'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { auditStamp, createRecordValue, getRequired, nextId, updateRecordValue, withTransaction } from './utils/storage'

const acceptPlanOutputInputPipe = v.object({ proposalEventId: idPipe })
export type Input = PipeOutput<typeof acceptPlanOutputInputPipe>

export interface Result {
	deliveries: Delivery[]
	slices: Slice[]
	memories: Memory[]
	memoryRevisions: MemoryRevision[]
	links: Link[]
	proposalEvent: AgentRunEvent
	acceptedEvent: AgentRunEvent
}

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| ProposalAlreadyReviewedError
	| ProposalTypeMismatchError
	| AgentRunPurposeMismatchError
	| InvalidPlanOutputError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type PlanningAgentRun = AgentRun & { purpose: Extract<AgentRun['purpose'], { type: 'planning' }> }
type InvalidPlanOutputFields = InvalidPlanOutputError extends infer TError
	? TError extends { type: 'invalid-plan-output' }
		? Omit<TError, 'type'>
		: never
	: never

export function createAcceptPlanOutputCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('acceptPlanOutput', acceptPlanOutputInputPipe, (input, context) =>
		handleAcceptPlanOutput(runtime, input, context),
	)
}

async function handleAcceptPlanOutput(
	runtime: CoreRuntime,
	input: Input,
	context: CommandContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const stamp = auditStamp(runtime.values, context)
	return stamp.ok ? withTransaction(runtime.services, (storage) => acceptPlanOutput(runtime, storage, input, stamp.value)) : stamp
}

async function acceptPlanOutput(
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const proposal = await getPendingProposalForAgentRunPurpose(storage, input.proposalEventId, 'proposed-plan-output', 'planning')
	return proposal.ok ? acceptPlanProposal(runtime, storage, proposal.value.proposal, proposal.value.agentRun, stamp) : proposal
}

async function acceptPlanProposal(
	runtime: CoreRuntime,
	storage: CoreStorage,
	proposal: AgentRunEvent & { body: Extract<AgentRunEvent['body'], { type: 'proposed-plan-output' }> },
	agentRun: PlanningAgentRun,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const context = await planProposalContext(storage, proposal, agentRun)
	return context.ok ? materializeAcceptedPlanProposal(runtime, storage, proposal, context.value, stamp) : context
}

interface PlanProposalContext {
	agentRun: PlanningAgentRun
	planId: Id
	projectId: Id
	output: PlanOutputProposal
	existingDeliveryDependencies: Map<Id, Delivery>
	memoryRevisionTargets: Map<Id, Memory>
}

async function planProposalContext(
	storage: CoreStorage,
	proposal: AgentRunEvent & { body: Extract<AgentRunEvent['body'], { type: 'proposed-plan-output' }> },
	agentRun: PlanningAgentRun,
): Promise<CoreResult<PlanProposalContext, Exclude<Error, InvalidInputError>>> {
	const plan = await getRequired('plan', storage, agentRun.purpose.planId)
	if (!plan.ok) return plan

	const context = { agentRun, planId: plan.value.id, projectId: plan.value.projectId, output: proposal.body.output }
	return validatePlanOutputStorage(storage, context)
}

async function validatePlanOutputStorage(
	storage: CoreStorage,
	context: Omit<PlanProposalContext, 'existingDeliveryDependencies' | 'memoryRevisionTargets'>,
): Promise<CoreResult<PlanProposalContext, Exclude<Error, InvalidInputError>>> {
	const existingDeliveryDependencies = await validateDeliveryStorage(storage, context)
	if (!existingDeliveryDependencies.ok) return existingDeliveryDependencies

	const memoryParents = await validateMemoryCreationParents(storage, context.output.proposedMemoryCreations)
	if (!memoryParents.ok) return memoryParents

	const memoryRevisionTargets = await validateMemoryRevisionTargets(storage, context.output.proposedMemoryRevisions)
	return memoryRevisionTargets.ok
		? {
				ok: true,
				value: {
					...context,
					existingDeliveryDependencies: existingDeliveryDependencies.value,
					memoryRevisionTargets: memoryRevisionTargets.value,
				},
			}
		: memoryRevisionTargets
}

async function validateDeliveryStorage(
	storage: CoreStorage,
	context: Omit<PlanProposalContext, 'existingDeliveryDependencies' | 'memoryRevisionTargets'>,
): Promise<CoreResult<Map<Id, Delivery>, Exclude<Error, InvalidInputError>>> {
	const existingDeliveryDependencies = new Map<Id, Delivery>()
	for (const [deliveryKey, delivery] of sortedEntries(context.output.proposedDeliveries)) {
		const target = await validateDeliveryTarget(storage, context.projectId, deliveryKey, delivery)
		if (!target.ok) return target

		const dependencies = await validateExistingDeliveryDependencies(storage, delivery)
		if (!dependencies.ok) return dependencies
		for (const dependency of dependencies.value.values()) existingDeliveryDependencies.set(dependency.id, dependency)
	}
	return { ok: true, value: existingDeliveryDependencies }
}

async function validateDeliveryTarget(
	storage: CoreStorage,
	projectId: Id,
	proposedDeliveryKey: string,
	delivery: ProposedDelivery,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const repository = await getRequired('repository', storage, delivery.target.repositoryId)
	if (!repository.ok) return repository

	return repository.value.projectId === projectId
		? { ok: true, value: undefined }
		: invalidPlanOutput({ reason: 'repository-project-mismatch', proposedDeliveryKey, repositoryId: repository.value.id })
}

async function validateExistingDeliveryDependencies(
	storage: CoreStorage,
	delivery: ProposedDelivery,
): Promise<CoreResult<Map<Id, Delivery>, Exclude<Error, InvalidInputError>>> {
	const dependencies = new Map<Id, Delivery>()
	for (const deliveryId of sortedKeys(delivery.dependsOnDeliveryIds)) {
		const dependency = await getRequired('delivery', storage, deliveryId)
		if (!dependency.ok) return dependency
		dependencies.set(dependency.value.id, dependency.value)
	}
	return { ok: true, value: dependencies }
}

async function validateMemoryCreationParents(
	storage: CoreStorage,
	creations: PlanOutputProposal['proposedMemoryCreations'],
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	for (const creation of Object.values(creations)) {
		if (creation.parentId === null) continue
		const parent = await getRequired('memory', storage, creation.parentId)
		if (!parent.ok) return parent
	}
	return { ok: true, value: undefined }
}

async function validateMemoryRevisionTargets(
	storage: CoreStorage,
	revisions: PlanOutputProposal['proposedMemoryRevisions'],
): Promise<CoreResult<Map<Id, Memory>, Exclude<Error, InvalidInputError>>> {
	const targets = new Map<Id, Memory>()
	for (const [memoryId, revision] of sortedEntries(revisions)) {
		const memory = await getRequired('memory', storage, memoryId)
		if (!memory.ok) return memory

		const freshness = validateExpectedRevision(memory.value, revision)
		if (!freshness.ok) return freshness
		const changed = validateChangedRevision(memory.value, revision)
		if (!changed.ok) return changed

		targets.set(memoryId, memory.value)
	}
	return { ok: true, value: targets }
}

function validateExpectedRevision(memory: Memory, revision: ProposedMemoryRevision): CoreResult<void, InvalidPlanOutputError> {
	return memory.currentRevision.id === revision.expectedCurrentRevisionId
		? { ok: true, value: undefined }
		: invalidPlanOutput({
				reason: 'stale-memory-revision',
				memoryId: memory.id,
				expectedCurrentRevisionId: revision.expectedCurrentRevisionId,
				actualCurrentRevisionId: memory.currentRevision.id,
			})
}

function validateChangedRevision(memory: Memory, revision: ProposedMemoryRevision): CoreResult<void, InvalidPlanOutputError> {
	return memory.currentRevision.title !== revision.title || memory.currentRevision.body !== revision.body
		? { ok: true, value: undefined }
		: invalidPlanOutput({ reason: 'noop-memory-revision', memoryId: memory.id })
}

interface MaterializedPlanOutput {
	deliveries: Delivery[]
	slices: Slice[]
	memories: Memory[]
	memoryRevisions: MemoryRevision[]
	memoryUpdates: Memory[]
	links: Link[]
}

async function materializeAcceptedPlanProposal(
	runtime: CoreRuntime,
	storage: CoreStorage,
	proposal: AgentRunEvent,
	context: PlanProposalContext,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const materialized = materializedPlanOutput(runtime, context, stamp)
	if (!materialized.ok) return materialized

	const stored = await storeMaterializedPlanOutput(storage, materialized.value)
	if (!stored.ok) return stored

	const acceptedEvent = await appendAgentRunEvent(runtime, storage, proposal.agentRunId, {
		type: 'proposal-accepted',
		proposalCursor: proposal.cursor,
		authorized: stamp,
		materialized: {
			type: 'plan-output',
			deliveryIds: stored.value.deliveries.map((record) => record.id),
			sliceIds: stored.value.slices.map((record) => record.id),
			memoryIds: stored.value.memories.map((record) => record.id),
			memoryRevisionIds: stored.value.memoryRevisions.map((record) => record.id),
			linkIds: stored.value.links.map((record) => record.id),
		},
	})
	return acceptedEvent.ok
		? { ok: true, value: { ...stored.value, proposalEvent: proposal, acceptedEvent: acceptedEvent.value } }
		: acceptedEvent
}

function materializedPlanOutput(
	runtime: CoreRuntime,
	context: PlanProposalContext,
	stamp: AuditStamp,
): CoreResult<MaterializedPlanOutput, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	const builder = new PlanOutputBuilder(runtime, context, stamp)
	return builder.build()
}

class PlanOutputBuilder {
	readonly #deliveryIds = new Map<string, Id>()
	readonly #sliceIds = new Map<string, Map<string, Id>>()
	readonly #deliveries: Delivery[] = []
	readonly #slices: Slice[] = []
	readonly #memories: Memory[] = []
	readonly #memoryRevisions: MemoryRevision[] = []
	readonly #memoryUpdates: Memory[] = []
	readonly #deliveryDependencyLinks: Link[] = []
	readonly #sliceDependencyLinks: Link[] = []
	readonly #memoryProducedLinks: Link[] = []
	readonly #memoryRevisionProducedLinks: Link[] = []

	constructor(
		private readonly runtime: CoreRuntime,
		private readonly context: PlanProposalContext,
		private readonly stamp: AuditStamp,
	) {}

	build(): CoreResult<MaterializedPlanOutput, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
		const deliveries = this.buildDeliveries()
		if (!deliveries.ok) return deliveries

		const newMemories = this.buildMemoryCreations()
		if (!newMemories.ok) return newMemories

		const revisions = this.buildExistingMemoryRevisions()
		if (!revisions.ok) return revisions

		const links = this.buildLinks()
		if (!links.ok) return links

		return { ok: true, value: this.output() }
	}

	private buildDeliveries(): CoreResult<void, InvalidCoreServiceOutputError> {
		for (const [deliveryKey, proposed] of sortedEntries(this.context.output.proposedDeliveries)) {
			const deliveryId = nextId(this.runtime.values, 'delivery')
			if (!deliveryId.ok) return deliveryId
			this.#deliveryIds.set(deliveryKey, deliveryId.value)
			this.#deliveries.push({
				id: deliveryId.value,
				projectId: this.context.projectId,
				planId: this.context.planId,
				title: proposed.title,
				target: proposed.target,
				config: null,
				accepted: this.stamp,
				queued: null,
				closed: null,
			})
			const slices = this.buildSlices(deliveryKey, proposed, deliveryId.value)
			if (!slices.ok) return slices
		}
		return { ok: true, value: undefined }
	}

	private buildSlices(deliveryKey: string, proposed: ProposedDelivery, deliveryId: Id): CoreResult<void, InvalidCoreServiceOutputError> {
		const sliceIds = new Map<string, Id>()
		for (const [sliceKey, proposedSlice] of sortedSlices(proposed.slices)) {
			const sliceId = nextId(this.runtime.values, 'slice')
			if (!sliceId.ok) return sliceId
			sliceIds.set(sliceKey, sliceId.value)
			this.#slices.push({
				id: sliceId.value,
				deliveryId,
				order: proposedSlice.order,
				title: proposedSlice.title,
				instruction: proposedSlice.instruction,
				accepted: this.stamp,
			})
		}
		this.#sliceIds.set(deliveryKey, sliceIds)
		return { ok: true, value: undefined }
	}

	private buildMemoryCreations(): CoreResult<void, InvalidCoreServiceOutputError> {
		for (const [, creation] of sortedEntries(this.context.output.proposedMemoryCreations)) {
			const memory = this.buildMemoryCreation(creation, creation.parentId)
			if (!memory.ok) return memory
		}
		return { ok: true, value: undefined }
	}

	private buildMemoryCreation(
		creation: ProposedMemoryCreation | ProposedChildMemoryCreation,
		parentId: Id | null,
	): CoreResult<Id, InvalidCoreServiceOutputError> {
		const memoryId = nextId(this.runtime.values, 'memory')
		if (!memoryId.ok) return memoryId
		const revisionId = nextId(this.runtime.values, 'memory-revision')
		if (!revisionId.ok) return revisionId

		const revision = memoryRevision(revisionId.value, memoryId.value, creation.title, creation.body, this.stamp)
		const memory = memoryRecord(memoryId.value, parentId, revision, this.stamp)
		this.#memoryRevisions.push(revision)
		this.#memories.push(memory)

		for (const [, child] of sortedEntries(creation.children)) {
			const childMemory = this.buildMemoryCreation(child, memoryId.value)
			if (!childMemory.ok) return childMemory
		}
		return { ok: true, value: memoryId.value }
	}

	private buildExistingMemoryRevisions(): CoreResult<void, InvalidCoreServiceOutputError> {
		for (const [memoryId, proposed] of sortedEntries(this.context.output.proposedMemoryRevisions)) {
			const revisionId = nextId(this.runtime.values, 'memory-revision')
			if (!revisionId.ok) return revisionId
			const revision = memoryRevision(revisionId.value, memoryId, proposed.title, proposed.body, this.stamp)
			const memory = this.context.memoryRevisionTargets.get(memoryId)!
			this.#memoryRevisions.push(revision)
			this.#memoryUpdates.push({ ...memory, currentRevision: currentRevision(revision) })
		}
		return { ok: true, value: undefined }
	}

	private buildLinks(): CoreResult<void, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
		const delivery = this.buildDeliveryDependencyLinks()
		if (!delivery.ok) return delivery
		const slice = this.buildSliceDependencyLinks()
		if (!slice.ok) return slice
		const memory = this.buildMemoryProducedLinks()
		if (!memory.ok) return memory
		return this.buildMemoryRevisionProducedLinks()
	}

	private buildDeliveryDependencyLinks(): CoreResult<void, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
		for (const [deliveryKey, delivery] of sortedEntries(this.context.output.proposedDeliveries)) {
			const from = this.#deliveryIds.get(deliveryKey)!
			for (const dependency of sortedKeys(delivery.dependsOnDeliveryIds)) {
				const dependencyDelivery = this.context.existingDeliveryDependencies.get(dependency)!
				const def = {
					type: 'depends-on',
					from: { type: 'delivery', projectId: this.context.projectId, id: from },
					to: { type: 'delivery', projectId: dependencyDelivery.projectId, id: dependency },
				} satisfies LinkDef
				if (dependencyDelivery.projectId !== this.context.projectId)
					return invalidPlanOutput({ reason: 'project-boundary-mismatch', def })
				const link = this.pushLink(this.#deliveryDependencyLinks, def)
				if (!link.ok) return link
			}
			for (const dependency of sortedKeys(delivery.dependsOnProposedDeliveryKeys)) {
				const def = {
					type: 'depends-on',
					from: { type: 'delivery', projectId: this.context.projectId, id: from },
					to: { type: 'delivery', projectId: this.context.projectId, id: this.#deliveryIds.get(dependency)! },
				} satisfies LinkDef
				const link = this.pushLink(this.#deliveryDependencyLinks, def)
				if (!link.ok) return link
			}
		}
		return { ok: true, value: undefined }
	}

	private buildSliceDependencyLinks(): CoreResult<void, InvalidCoreServiceOutputError> {
		for (const [deliveryKey, delivery] of sortedEntries(this.context.output.proposedDeliveries)) {
			const deliveryId = this.#deliveryIds.get(deliveryKey)!
			const sliceIds = this.#sliceIds.get(deliveryKey)!
			for (const [sliceKey, slice] of sortedSlices(delivery.slices)) {
				for (const dependency of sortedKeys(slice.dependsOnProposedSliceKeys)) {
					const def = {
						type: 'depends-on',
						from: { type: 'slice', projectId: this.context.projectId, deliveryId, id: sliceIds.get(sliceKey)! },
						to: { type: 'slice', projectId: this.context.projectId, deliveryId, id: sliceIds.get(dependency)! },
					} satisfies LinkDef
					const link = this.pushLink(this.#sliceDependencyLinks, def)
					if (!link.ok) return link
				}
			}
		}
		return { ok: true, value: undefined }
	}

	private buildMemoryProducedLinks(): CoreResult<void, InvalidCoreServiceOutputError> {
		for (const memory of this.#memories) {
			const def = {
				type: 'produced',
				from: { type: 'plan', projectId: this.context.projectId, id: this.context.planId },
				to: { type: 'memory', id: memory.id },
			} satisfies LinkDef
			const link = this.pushLink(this.#memoryProducedLinks, def)
			if (!link.ok) return link
		}
		return { ok: true, value: undefined }
	}

	private buildMemoryRevisionProducedLinks(): CoreResult<void, InvalidCoreServiceOutputError> {
		for (const revision of this.#memoryRevisions) {
			const def = {
				type: 'produced',
				from: { type: 'plan', projectId: this.context.projectId, id: this.context.planId },
				to: { type: 'memory-revision', memoryId: revision.memoryId, id: revision.id },
			} satisfies LinkDef
			const link = this.pushLink(this.#memoryRevisionProducedLinks, def)
			if (!link.ok) return link
		}
		return { ok: true, value: undefined }
	}

	private pushLink(links: Link[], def: LinkDef): CoreResult<void, InvalidCoreServiceOutputError> {
		const id = nextId(this.runtime.values, 'link')
		if (!id.ok) return id
		links.push({ id: id.value, def, created: this.stamp })
		return { ok: true, value: undefined }
	}

	private output(): MaterializedPlanOutput {
		return {
			deliveries: this.#deliveries,
			slices: this.#slices,
			memories: this.#memories,
			memoryRevisions: this.#memoryRevisions,
			memoryUpdates: this.#memoryUpdates,
			links: [
				...this.#deliveryDependencyLinks,
				...this.#sliceDependencyLinks,
				...this.#memoryProducedLinks,
				...this.#memoryRevisionProducedLinks,
			],
		}
	}
}

function memoryRevision(id: Id, memoryId: Id, title: string, body: string, stamp: AuditStamp): MemoryRevision {
	return { id, memoryId, title, body, created: stamp }
}

function memoryRecord(id: Id, parentId: Id | null, revision: MemoryRevision, stamp: AuditStamp): Memory {
	return { id, parentId, currentRevision: currentRevision(revision), created: stamp }
}

function currentRevision(revision: MemoryRevision): Memory['currentRevision'] {
	return { id: revision.id, title: revision.title, body: revision.body, created: revision.created }
}

async function storeMaterializedPlanOutput(
	storage: CoreStorage,
	output: MaterializedPlanOutput,
): Promise<CoreResult<Omit<MaterializedPlanOutput, 'memoryUpdates'>, Exclude<Error, InvalidInputError>>> {
	const stored = await storeMaterializedRecords(storage, output)
	return stored.ok
		? {
				ok: true,
				value: {
					deliveries: output.deliveries,
					slices: output.slices,
					memories: output.memories,
					memoryRevisions: output.memoryRevisions,
					links: output.links,
				},
			}
		: stored
}

async function storeMaterializedRecords(
	storage: CoreStorage,
	output: MaterializedPlanOutput,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const results = [
		await storeRecordSet('delivery', storage, output.deliveries),
		await storeRecordSet('slice', storage, output.slices),
		await storeRecordSet('memory-revision', storage, output.memoryRevisions),
		await storeRecordSet('memory', storage, output.memories),
		await updateMemoryRecords(storage, output.memoryUpdates),
		await storeRecordSet('link', storage, output.links),
	]
	return firstFailure(results) ?? { ok: true, value: undefined }
}

async function storeRecordSet<TResource extends 'delivery' | 'slice' | 'memory' | 'memory-revision' | 'link'>(
	resource: TResource,
	storage: CoreStorage,
	records: Parameters<typeof createRecordValue<TResource>>[2][],
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	for (const record of records) {
		const stored = await createRecordValue(resource, storage, record)
		if (!stored.ok) return stored
	}
	return { ok: true, value: undefined }
}

async function updateMemoryRecords(storage: CoreStorage, memories: Memory[]): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	for (const memory of memories) {
		const stored = await updateRecordValue('memory', storage, memory.id, { currentRevision: memory.currentRevision })
		if (!stored.ok) return stored
	}
	return { ok: true, value: undefined }
}

function firstFailure<TError>(results: Array<CoreResult<unknown, TError>>): CoreResult<never, TError> | null {
	return results.find((result): result is CoreResult<never, TError> => !result.ok) ?? null
}

function sortedEntries<T>(record: Record<string, T>): Array<[string, T]> {
	return Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
}

function sortedKeys(record: Record<string, true>): string[] {
	return Object.keys(record).sort((left, right) => left.localeCompare(right))
}

function sortedSlices(slices: ProposedDelivery['slices']): Array<[string, ProposedDelivery['slices'][string]]> {
	return Object.entries(slices).sort(([, left], [, right]) => left.order - right.order)
}

function invalidPlanOutput(error: InvalidPlanOutputFields): CoreResult<never, InvalidPlanOutputError> {
	return { ok: false, error: { type: 'invalid-plan-output', ...error } as InvalidPlanOutputError }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, stamp } = await import('../utils/test-helpers')

	describe('acceptPlanOutput command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRunEvents.fail.get = true
			const command = createAcceptPlanOutputCommand(createTestCoreRuntime(options))

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'acceptPlanOutput' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('accepts keyed Delivery and Memory proposals and materializes facts', async () => {
			const options = proposalFixture()
			const command = createAcceptPlanOutputCommand(createTestCoreRuntime(options))

			const result = await command({ proposalEventId: 'proposal-event' }, context)

			expect(result).toMatchObject({
				ok: true,
				value: {
					deliveries: [{ id: 'delivery-1', projectId: 'project-1', planId: 'plan-1', title: 'Delivery' }],
					slices: [{ id: 'slice-1', deliveryId: 'delivery-1', title: 'Slice', order: 0 }],
					memories: [
						{ id: 'memory-1', parentId: null, currentRevision: { id: 'memory-revision-1', title: 'Memory' } },
						{ id: 'memory-2', parentId: 'memory-1', currentRevision: { id: 'memory-revision-2', title: 'Child' } },
					],
					memoryRevisions: [
						{ id: 'memory-revision-1', memoryId: 'memory-1', title: 'Memory' },
						{ id: 'memory-revision-2', memoryId: 'memory-2', title: 'Child' },
						{ id: 'memory-revision-3', memoryId: 'existing-memory', title: 'Existing memory' },
					],
					acceptedEvent: {
						body: {
							type: 'proposal-accepted',
							proposalCursor: '01J00000000000000000000000',
							materialized: {
								type: 'plan-output',
								deliveryIds: ['delivery-1'],
								sliceIds: ['slice-1'],
								memoryIds: ['memory-1', 'memory-2'],
								memoryRevisionIds: ['memory-revision-1', 'memory-revision-2', 'memory-revision-3'],
								linkIds: ['link-1', 'link-2', 'link-3', 'link-4', 'link-5'],
							},
						},
					},
				},
			})
			expect(options.tx.memories.records.get('existing-memory')?.currentRevision).toMatchObject({ id: 'memory-revision-3' })
			expect(result.ok ? result.value.links : []).toMatchObject([
				{
					id: 'link-1',
					def: {
						type: 'produced',
						from: { type: 'plan', projectId: 'project-1', id: 'plan-1' },
						to: { type: 'memory', id: 'memory-1' },
					},
				},
				{
					id: 'link-2',
					def: {
						type: 'produced',
						from: { type: 'plan', projectId: 'project-1', id: 'plan-1' },
						to: { type: 'memory', id: 'memory-2' },
					},
				},
				{
					id: 'link-3',
					def: {
						type: 'produced',
						from: { type: 'plan', projectId: 'project-1', id: 'plan-1' },
						to: { type: 'memory-revision', memoryId: 'memory-1', id: 'memory-revision-1' },
					},
				},
				{
					id: 'link-4',
					def: {
						type: 'produced',
						from: { type: 'plan', projectId: 'project-1', id: 'plan-1' },
						to: { type: 'memory-revision', memoryId: 'memory-2', id: 'memory-revision-2' },
					},
				},
				{
					id: 'link-5',
					def: {
						type: 'produced',
						from: { type: 'plan', projectId: 'project-1', id: 'plan-1' },
						to: { type: 'memory-revision', memoryId: 'existing-memory', id: 'memory-revision-3' },
					},
				},
			])
		})

		it('rejects stale and no-op Memory revisions', async () => {
			const stale = proposalFixture()
			stale.tx.agentRunEvents.records.set(
				'proposal-event',
				proposalEvent({
					proposedDeliveries: {},
					proposedMemoryCreations: {},
					proposedMemoryRevisions: {
						'existing-memory': { expectedCurrentRevisionId: 'stale', title: 'Existing memory', body: 'Updated body.' },
					},
				}),
			)
			const command = createAcceptPlanOutputCommand(createTestCoreRuntime(stale))

			await expect(command({ proposalEventId: 'proposal-event' }, context)).resolves.toEqual({
				ok: false,
				error: {
					type: 'invalid-plan-output',
					reason: 'stale-memory-revision',
					memoryId: 'existing-memory',
					expectedCurrentRevisionId: 'stale',
					actualCurrentRevisionId: 'existing-memory-revision',
				},
			})

			const noop = proposalFixture()
			noop.tx.agentRunEvents.records.set(
				'proposal-event',
				proposalEvent({
					proposedDeliveries: {},
					proposedMemoryCreations: {},
					proposedMemoryRevisions: {
						'existing-memory': {
							expectedCurrentRevisionId: 'existing-memory-revision',
							title: 'Existing memory',
							body: 'Existing body.',
						},
					},
				}),
			)
			await expect(
				createAcceptPlanOutputCommand(createTestCoreRuntime(noop))({ proposalEventId: 'proposal-event' }, context),
			).resolves.toEqual({
				ok: false,
				error: { type: 'invalid-plan-output', reason: 'noop-memory-revision', memoryId: 'existing-memory' },
			})
		})

		it('rejects cross-Project existing Delivery dependencies', async () => {
			const options = proposalFixture()
			options.tx.deliveries.records.set('other-delivery', {
				id: 'other-delivery',
				projectId: 'other-project',
				planId: 'other-plan',
				title: 'Other',
				target: { type: 'source-control', repositoryId: 'repository-1', targetBranch: 'main' },
				config: null,
				accepted: stamp,
				queued: null,
				closed: null,
			})
			options.tx.agentRunEvents.records.set(
				'proposal-event',
				proposalEvent({
					...planOutput(),
					proposedDeliveries: {
						...planOutput().proposedDeliveries,
						delivery: { ...planOutput().proposedDeliveries.delivery!, dependsOnDeliveryIds: { 'other-delivery': true } },
					},
				}),
			)

			const result = await createAcceptPlanOutputCommand(createTestCoreRuntime(options))(
				{ proposalEventId: 'proposal-event' },
				context,
			)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'invalid-plan-output',
					reason: 'project-boundary-mismatch',
					def: {
						type: 'depends-on',
						from: { type: 'delivery', projectId: 'project-1', id: 'delivery-1' },
						to: { type: 'delivery', projectId: 'other-project', id: 'other-delivery' },
					},
				},
			})
		})
	})

	function proposalFixture() {
		const options = createTestCoreServices()
		options.tx.plans.records.set('plan-1', {
			id: 'plan-1',
			projectId: 'project-1',
			title: 'Plan',
			created: localStamp(),
			closed: null,
		})
		options.tx.repositories.records.set('repository-1', {
			id: 'repository-1',
			projectId: 'project-1',
			config: { provider: 'github', owner: 'owner', name: 'repo', secretId: 'secret-1' },
			created: localStamp(),
		})
		options.tx.memories.records.set('existing-memory', {
			id: 'existing-memory',
			parentId: null,
			created: localStamp(),
			currentRevision: { id: 'existing-memory-revision', title: 'Existing memory', body: 'Existing body.', created: localStamp() },
		})
		options.tx.agentRuns.records.set('agent-run-1', {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: 'plan-1' },
			profile: {
				agentRunProfileId: 'agent-run-profile-1',
				name: 'Agent Run Profile',
				modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
			},
			modelUseOverride: null,
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		})
		options.tx.agentRunEvents.records.set('proposal-event', proposalEvent(planOutput()))
		return options
	}

	function proposalEvent(output: PlanOutputProposal): AgentRunEvent {
		return {
			id: 'proposal-event',
			agentRunId: 'agent-run-1',
			cursor: '01J00000000000000000000000',
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: { type: 'proposed-plan-output', toolCallStartedCursor: '01J00000000000000000000000', output },
		}
	}

	function planOutput(): PlanOutputProposal {
		return {
			proposedDeliveries: {
				delivery: {
					title: 'Delivery',
					target: { type: 'source-control', repositoryId: 'repository-1', targetBranch: 'main' },
					slices: {
						slice: {
							order: 0,
							title: 'Slice',
							instruction: { body: 'Do work.' },
							dependsOnProposedSliceKeys: {},
						},
					},
					dependsOnDeliveryIds: {},
					dependsOnProposedDeliveryKeys: {},
				},
			},
			proposedMemoryCreations: {
				memory: {
					parentId: null,
					title: 'Memory',
					body: 'Remember this.',
					children: { child: { title: 'Child', body: 'Remember child.', children: {} } },
				},
			},
			proposedMemoryRevisions: {
				'existing-memory': {
					expectedCurrentRevisionId: 'existing-memory-revision',
					title: 'Existing memory',
					body: 'Updated body.',
				},
			},
		}
	}
}
