import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRun } from '../domain/agent-run'
import type { AgentRunEvent } from '../domain/agent-run-event'
import { idPipe, type AuditStamp, type Id } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { Link, LinkDef } from '../domain/link'
import type { Memory } from '../domain/memory'
import type { MemoryRevision } from '../domain/memory-revision'
import type { PlanOutputProposal, ProposedChildMemoryCreation, ProposedDelivery, ProposedMemoryCreation } from '../domain/plan'
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
import type { CoreStorage } from '../services'
import { appendAgentRunEvent } from '../utils/agent-runs'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, createRecordValue, getRequired, nextId, updateRecordValue, withTransaction } from '../utils/command-storage'
import { getPendingProposalForAgentRunPurpose, proposalAcceptedProjectedParts } from '../utils/proposals'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

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
	return buildCommandHandler('acceptPlanOutput', acceptPlanOutputInputPipe, async (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return stamp

		return withTransaction<Result, Exclude<Error, InvalidInputError>>(runtime.services, async (storage) => {
			const proposal = await getPendingProposalForAgentRunPurpose(storage, input.proposalEventId, 'proposed-plan-output', 'planning')
			if (!proposal.ok) return proposal

			const plan = await getRequired('plan', storage, proposal.value.agentRun.purpose.planId)
			if (!plan.ok) return plan

			const proposalContext = {
				agentRun: proposal.value.agentRun,
				planId: plan.value.id,
				projectId: plan.value.projectId,
				output: proposal.value.proposal.body.output,
			}
			const validatedContext = await validatePlanProposalContext(storage, proposalContext)
			return validatedContext.ok
				? materializeAcceptedPlanProposal(runtime, storage, proposal.value.proposal, validatedContext.value, stamp.value)
				: validatedContext
		})
	})
}

interface PlanProposalContext {
	agentRun: PlanningAgentRun
	planId: Id
	projectId: Id
	output: PlanOutputProposal
	existingDeliveryDependencies: Map<Id, Delivery>
	memoryRevisionTargets: Map<Id, Memory>
}

async function validatePlanProposalContext(
	storage: CoreStorage,
	context: Omit<PlanProposalContext, 'existingDeliveryDependencies' | 'memoryRevisionTargets'>,
): Promise<CoreResult<PlanProposalContext, Exclude<Error, InvalidInputError>>> {
	const existingDeliveryDependencies = await validatePlanDeliveryReferences(storage, context)
	if (!existingDeliveryDependencies.ok) return existingDeliveryDependencies

	const memoryParents = await validatePlanMemoryParents(storage, context.output.proposedMemoryCreations)
	if (!memoryParents.ok) return memoryParents

	const memoryRevisionTargets = await validatePlanMemoryRevisions(storage, context.output.proposedMemoryRevisions)
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

async function validatePlanDeliveryReferences(
	storage: CoreStorage,
	context: Omit<PlanProposalContext, 'existingDeliveryDependencies' | 'memoryRevisionTargets'>,
): Promise<CoreResult<Map<Id, Delivery>, Exclude<Error, InvalidInputError>>> {
	const dependencies = new Map<Id, Delivery>()
	for (const [deliveryKey, delivery] of sortedEntries(context.output.proposedDeliveries)) {
		const repository = await getRequired('repository', storage, delivery.target.repositoryId)
		if (!repository.ok) return repository
		if (repository.value.projectId !== context.projectId) {
			return invalidPlanOutput({
				reason: 'repository-project-mismatch',
				proposedDeliveryKey: deliveryKey,
				repositoryId: repository.value.id,
			})
		}

		for (const deliveryId of sortedKeys(delivery.dependsOnDeliveryIds)) {
			const dependency = await getRequired('delivery', storage, deliveryId)
			if (!dependency.ok) return dependency
			dependencies.set(dependency.value.id, dependency.value)
		}
	}
	return { ok: true, value: dependencies }
}

async function validatePlanMemoryParents(
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

async function validatePlanMemoryRevisions(
	storage: CoreStorage,
	revisions: PlanOutputProposal['proposedMemoryRevisions'],
): Promise<CoreResult<Map<Id, Memory>, Exclude<Error, InvalidInputError>>> {
	const targets = new Map<Id, Memory>()
	for (const [memoryId, revision] of sortedEntries(revisions)) {
		const memory = await getRequired('memory', storage, memoryId)
		if (!memory.ok) return memory
		if (memory.value.currentRevision.id !== revision.expectedCurrentRevisionId) {
			return invalidPlanOutput({
				reason: 'stale-memory-revision',
				memoryId: memory.value.id,
				expectedCurrentRevisionId: revision.expectedCurrentRevisionId,
				actualCurrentRevisionId: memory.value.currentRevision.id,
			})
		}
		if (memory.value.currentRevision.title === revision.title && memory.value.currentRevision.body === revision.body) {
			return invalidPlanOutput({ reason: 'noop-memory-revision', memoryId: memory.value.id })
		}
		targets.set(memoryId, memory.value)
	}
	return { ok: true, value: targets }
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
	const materialized = new PlanOutputBuilder(runtime, context, stamp).build()
	if (!materialized.ok) return materialized

	const deliveryResult = await storeRecordSet('delivery', storage, materialized.value.deliveries)
	const sliceResult = await storeRecordSet('slice', storage, materialized.value.slices)
	const memoryRevisionResult = await storeRecordSet('memory-revision', storage, materialized.value.memoryRevisions)
	const memoryResult = await storeRecordSet('memory', storage, materialized.value.memories)
	let memoryUpdateResult: CoreResult<void, Exclude<Error, InvalidInputError>> = { ok: true, value: undefined }
	for (const memory of materialized.value.memoryUpdates) {
		const stored = await updateRecordValue('memory', storage, memory.id, { currentRevision: memory.currentRevision })
		if (!stored.ok) {
			memoryUpdateResult = stored
			break
		}
	}
	const linkResult = await storeRecordSet('link', storage, materialized.value.links)
	const storageFailure = [deliveryResult, sliceResult, memoryRevisionResult, memoryResult, memoryUpdateResult, linkResult].find(
		(result) => !result.ok,
	)
	if (storageFailure !== undefined && !storageFailure.ok) return storageFailure

	const acceptedEvent = await appendAgentRunEvent(runtime, storage, proposal.agentRunId, {
		type: 'proposal-accepted',
		proposalEventId: proposal.id,
		authorized: stamp,
		materialized: {
			type: 'plan-output',
			deliveryIds: materialized.value.deliveries.map((record) => record.id),
			sliceIds: materialized.value.slices.map((record) => record.id),
			memoryIds: materialized.value.memories.map((record) => record.id),
			memoryRevisionIds: materialized.value.memoryRevisions.map((record) => record.id),
			linkIds: materialized.value.links.map((record) => record.id),
		},
		projectedParts: proposalAcceptedProjectedParts(proposal.id),
	})
	return acceptedEvent.ok
		? {
				ok: true,
				value: {
					deliveries: materialized.value.deliveries,
					slices: materialized.value.slices,
					memories: materialized.value.memories,
					memoryRevisions: materialized.value.memoryRevisions,
					links: materialized.value.links,
					proposalEvent: proposal,
					acceptedEvent: acceptedEvent.value,
				},
			}
		: acceptedEvent
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
			const deliveryId = nextId(this.runtime.values)
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
			const sliceId = nextId(this.runtime.values)
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
		const memoryId = nextId(this.runtime.values)
		if (!memoryId.ok) return memoryId
		const revisionId = nextId(this.runtime.values)
		if (!revisionId.ok) return revisionId

		const revision = memoryRevision(revisionId.value, memoryId.value, creation.title, creation.body, this.stamp)
		const memory: Memory = {
			id: memoryId.value,
			parentId,
			currentRevision: currentRevision(revision),
			created: this.stamp,
		}
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
			const revisionId = nextId(this.runtime.values)
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
		const id = nextId(this.runtime.values)
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

function currentRevision(revision: MemoryRevision): Memory['currentRevision'] {
	return { id: revision.id, title: revision.title, body: revision.body, created: revision.created }
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
	const { context, createTestCoreRuntime, createTestCoreServices, defaultAgentRunSandboxConfig, localStamp, stamp } =
		await import('../utils/test-helpers')
	const proposalEventId = '01k00000000000000000000003'
	const existingMemoryId = '01k00000000000000000000050'
	const existingMemoryRevisionId = '01k00000000000000000000051'
	const staleMemoryRevisionId = '01k00000000000000000000052'
	const otherProjectId = '01k00000000000000000000053'
	const otherPlanId = '01k00000000000000000000054'
	const otherDeliveryId = '01k00000000000000000000055'

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

			const result = await command({ proposalEventId: proposalEventId }, context)

			expect(result).toMatchObject({
				ok: true,
				value: {
					deliveries: [
						{
							id: '01k00000000000000000010001',
							projectId: '01k00000000000000000000030',
							planId: '01k00000000000000000000028',
							title: 'Delivery',
						},
					],
					slices: [{ id: '01k00000000000000000010002', deliveryId: '01k00000000000000000010001', title: 'Slice', order: 0 }],
					memories: [
						{
							id: '01k00000000000000000010003',
							parentId: null,
							currentRevision: { id: '01k00000000000000000010004', title: 'Memory' },
						},
						{
							id: '01k00000000000000000010005',
							parentId: '01k00000000000000000010003',
							currentRevision: { id: '01k00000000000000000010006', title: 'Child' },
						},
					],
					memoryRevisions: [
						{ id: '01k00000000000000000010004', memoryId: '01k00000000000000000010003', title: 'Memory' },
						{ id: '01k00000000000000000010006', memoryId: '01k00000000000000000010005', title: 'Child' },
						{ id: '01k00000000000000000010007', memoryId: existingMemoryId, title: 'Existing memory' },
					],
					acceptedEvent: {
						body: {
							type: 'proposal-accepted',
							proposalEventId,
							materialized: {
								type: 'plan-output',
								deliveryIds: ['01k00000000000000000010001'],
								sliceIds: ['01k00000000000000000010002'],
								memoryIds: ['01k00000000000000000010003', '01k00000000000000000010005'],
								memoryRevisionIds: [
									'01k00000000000000000010004',
									'01k00000000000000000010006',
									'01k00000000000000000010007',
								],
								linkIds: [
									'01k00000000000000000010008',
									'01k00000000000000000010009',
									'01k00000000000000000010010',
									'01k00000000000000000010011',
									'01k00000000000000000010012',
								],
							},
						},
					},
				},
			})
			expect(options.tx.memories.records.get(existingMemoryId)?.currentRevision).toMatchObject({ id: '01k00000000000000000010007' })
			expect(result.ok ? result.value.links : []).toMatchObject([
				{
					id: '01k00000000000000000010008',
					def: {
						type: 'produced',
						from: { type: 'plan', projectId: '01k00000000000000000000030', id: '01k00000000000000000000028' },
						to: { type: 'memory', id: '01k00000000000000000010003' },
					},
				},
				{
					id: '01k00000000000000000010009',
					def: {
						type: 'produced',
						from: { type: 'plan', projectId: '01k00000000000000000000030', id: '01k00000000000000000000028' },
						to: { type: 'memory', id: '01k00000000000000000010005' },
					},
				},
				{
					id: '01k00000000000000000010010',
					def: {
						type: 'produced',
						from: { type: 'plan', projectId: '01k00000000000000000000030', id: '01k00000000000000000000028' },
						to: { type: 'memory-revision', memoryId: '01k00000000000000000010003', id: '01k00000000000000000010004' },
					},
				},
				{
					id: '01k00000000000000000010011',
					def: {
						type: 'produced',
						from: { type: 'plan', projectId: '01k00000000000000000000030', id: '01k00000000000000000000028' },
						to: { type: 'memory-revision', memoryId: '01k00000000000000000010005', id: '01k00000000000000000010006' },
					},
				},
				{
					id: '01k00000000000000000010012',
					def: {
						type: 'produced',
						from: { type: 'plan', projectId: '01k00000000000000000000030', id: '01k00000000000000000000028' },
						to: { type: 'memory-revision', memoryId: existingMemoryId, id: '01k00000000000000000010007' },
					},
				},
			])
		})

		it('rejects stale and no-op Memory revisions', async () => {
			const stale = proposalFixture()
			stale.tx.agentRunEvents.records.set(
				proposalEventId,
				proposalEvent({
					proposedDeliveries: {},
					proposedMemoryCreations: {},
					proposedMemoryRevisions: {
						[existingMemoryId]: {
							expectedCurrentRevisionId: staleMemoryRevisionId,
							title: 'Existing memory',
							body: 'Updated body.',
						},
					},
				}),
			)
			const command = createAcceptPlanOutputCommand(createTestCoreRuntime(stale))

			await expect(command({ proposalEventId: proposalEventId }, context)).resolves.toEqual({
				ok: false,
				error: {
					type: 'invalid-plan-output',
					reason: 'stale-memory-revision',
					memoryId: existingMemoryId,
					expectedCurrentRevisionId: staleMemoryRevisionId,
					actualCurrentRevisionId: existingMemoryRevisionId,
				},
			})

			const noop = proposalFixture()
			noop.tx.agentRunEvents.records.set(
				proposalEventId,
				proposalEvent({
					proposedDeliveries: {},
					proposedMemoryCreations: {},
					proposedMemoryRevisions: {
						[existingMemoryId]: {
							expectedCurrentRevisionId: existingMemoryRevisionId,
							title: 'Existing memory',
							body: 'Existing body.',
						},
					},
				}),
			)
			await expect(
				createAcceptPlanOutputCommand(createTestCoreRuntime(noop))({ proposalEventId: proposalEventId }, context),
			).resolves.toEqual({
				ok: false,
				error: { type: 'invalid-plan-output', reason: 'noop-memory-revision', memoryId: existingMemoryId },
			})
		})

		it('rejects cross-Project existing Delivery dependencies', async () => {
			const options = proposalFixture()
			options.tx.deliveries.records.set(otherDeliveryId, {
				id: otherDeliveryId,
				projectId: otherProjectId,
				planId: otherPlanId,
				title: 'Other',
				target: { type: 'source-control', repositoryId: '01k00000000000000000000034', targetBranch: 'main' },
				config: null,
				accepted: stamp,
				queued: null,
				closed: null,
			})
			options.tx.agentRunEvents.records.set(
				proposalEventId,
				proposalEvent({
					...planOutput(),
					proposedDeliveries: {
						...planOutput().proposedDeliveries,
						delivery: { ...planOutput().proposedDeliveries.delivery!, dependsOnDeliveryIds: { [otherDeliveryId]: true } },
					},
				}),
			)

			const result = await createAcceptPlanOutputCommand(createTestCoreRuntime(options))(
				{ proposalEventId: proposalEventId },
				context,
			)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'invalid-plan-output',
					reason: 'project-boundary-mismatch',
					def: {
						type: 'depends-on',
						from: { type: 'delivery', projectId: '01k00000000000000000000030', id: '01k00000000000000000010001' },
						to: { type: 'delivery', projectId: otherProjectId, id: otherDeliveryId },
					},
				},
			})
		})
	})

	function proposalFixture() {
		const options = createTestCoreServices()
		options.tx.plans.records.set('01k00000000000000000000028', {
			id: '01k00000000000000000000028',
			projectId: '01k00000000000000000000030',
			agentRunId: '01k00000000000000000000002',
			title: 'Plan',
			created: localStamp(),
			closed: null,
		})
		options.tx.repositories.records.set('01k00000000000000000000034', {
			id: '01k00000000000000000000034',
			projectId: '01k00000000000000000000030',
			config: { provider: 'github', owner: 'owner', name: 'repo', secretId: '01k00000000000000000000040' },
			created: localStamp(),
		})
		options.tx.memories.records.set(existingMemoryId, {
			id: existingMemoryId,
			parentId: null,
			created: localStamp(),
			currentRevision: { id: existingMemoryRevisionId, title: 'Existing memory', body: 'Existing body.', created: localStamp() },
		})
		options.tx.agentRuns.records.set('01k00000000000000000000002', {
			id: '01k00000000000000000000002',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: '01k00000000000000000000028' },
			profile: {
				agentRunProfileId: '01k00000000000000000000006',
				name: 'Agent Run Profile',
				modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
				runtimeRequirements: [],
				sandboxConfig: defaultAgentRunSandboxConfig(),
			},
			toolSet: [],
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: null,
			sandbox: null,
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		})
		options.tx.agentRunEvents.records.set(proposalEventId, proposalEvent(planOutput()))
		return options
	}

	function proposalEvent(output: PlanOutputProposal): AgentRunEvent {
		return {
			id: proposalEventId,
			agentRunId: '01k00000000000000000000002',
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: {
				type: 'proposed-plan-output',
				assistantMessageEventId: '01j00000000000000000000000',
				toolCallId: 'call-1',
				output,
			},
		}
	}

	function planOutput(): PlanOutputProposal {
		return {
			proposedDeliveries: {
				delivery: {
					title: 'Delivery',
					target: { type: 'source-control', repositoryId: '01k00000000000000000000034', targetBranch: 'main' },
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
				[existingMemoryId]: {
					expectedCurrentRevisionId: existingMemoryRevisionId,
					title: 'Existing memory',
					body: 'Updated body.',
				},
			},
		}
	}
}
