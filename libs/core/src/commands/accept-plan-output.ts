import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRun, AgentRunEvent } from '../domain/agent-run'
import { idPipe, type AuditStamp, type Id } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { GraphNodeRef, Link } from '../domain/graph'
import type { Memory, MemoryRevision } from '../domain/memory'
import type { PlanOutputProposal, ProposedDelivery, ProposedGraphRef, ProposedMemory } from '../domain/plan'
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
import { auditStamp, createRecordValue, getRequired, nextId, withTransaction } from './utils/storage'

const acceptPlanOutputInputPipe = v.object({ proposalEventId: idPipe })
export type Input = PipeOutput<typeof acceptPlanOutputInputPipe>

export interface Result {
	deliveries: Delivery[]
	slices: Slice[]
	memories: Memory[]
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
}

async function planProposalContext(
	storage: CoreStorage,
	proposal: AgentRunEvent & { body: Extract<AgentRunEvent['body'], { type: 'proposed-plan-output' }> },
	agentRun: PlanningAgentRun,
): Promise<CoreResult<PlanProposalContext, Exclude<Error, InvalidInputError>>> {
	const plan = await getRequired('plan', storage, agentRun.purpose.planId)
	return plan.ok
		? { ok: true, value: { agentRun, planId: plan.value.id, projectId: plan.value.projectId, output: proposal.body.output } }
		: plan
}

interface MaterializedPlanOutput {
	deliveries: Delivery[]
	slices: Slice[]
	memories: Memory[]
	memoryRevisions: MemoryRevision[]
	links: Link[]
}

async function materializeAcceptedPlanProposal(
	runtime: CoreRuntime,
	storage: CoreStorage,
	proposal: AgentRunEvent,
	context: PlanProposalContext,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const materialized = await materializedPlanOutput(runtime, storage, context, stamp)
	if (!materialized.ok) return materialized

	const stored = await storeMaterializedPlanOutput(storage, materialized.value)
	if (!stored.ok) return stored

	const acceptedEvent = await appendAgentRunEvent(runtime, storage, proposal.agentRunId, {
		type: 'proposal-accepted',
		proposalEventId: proposal.id,
		authorized: stamp,
		materialized: {
			type: 'plan-output',
			deliveryIds: stored.value.deliveries.map((record) => record.id),
			sliceIds: stored.value.slices.map((record) => record.id),
			memoryIds: stored.value.memories.map((record) => record.id),
			linkIds: stored.value.links.map((record) => record.id),
		},
	})
	return acceptedEvent.ok
		? { ok: true, value: { ...stored.value, proposalEvent: proposal, acceptedEvent: acceptedEvent.value } }
		: acceptedEvent
}

async function materializedPlanOutput(
	runtime: CoreRuntime,
	storage: CoreStorage,
	context: PlanProposalContext,
	stamp: AuditStamp,
): Promise<CoreResult<MaterializedPlanOutput, Exclude<Error, InvalidInputError>>> {
	const validation = await validatePlanOutput(storage, context)
	return validation.ok ? buildMaterializedPlanOutput(runtime, context, stamp) : validation
}

async function validatePlanOutput(
	storage: CoreStorage,
	context: PlanProposalContext,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const structural = validatePlanOutputStructure(context.output)
	if (!structural.ok) return structural

	return validateDeliveryTargets(storage, context)
}

function validatePlanOutputStructure(output: PlanOutputProposal): CoreResult<void, InvalidPlanOutputError> {
	const content = validatePlanOutputHasContent(output)
	if (!content.ok) return content

	const keys = validatePlanOutputKeys(output)
	return keys.ok ? validateProposedDeliveries(output.proposedDeliveries, keys.value.deliveryKeys) : keys
}

function validatePlanOutputHasContent(output: PlanOutputProposal): CoreResult<void, InvalidPlanOutputError> {
	return output.proposedDeliveries.length === 0 && output.proposedMemories.length === 0
		? invalidPlanOutput({ reason: 'empty-output' })
		: { ok: true, value: undefined }
}

function validatePlanOutputKeys(
	output: PlanOutputProposal,
): CoreResult<{ deliveryKeys: Set<string>; memoryKeys: Set<string> }, InvalidPlanOutputError> {
	const deliveryKeys = uniqueProposedDeliveryKeys(output.proposedDeliveries)
	if (!deliveryKeys.ok) return deliveryKeys

	const memoryKeys = uniqueProposedMemoryKeys(output.proposedMemories)
	return memoryKeys.ok ? { ok: true, value: { deliveryKeys: deliveryKeys.value, memoryKeys: memoryKeys.value } } : memoryKeys
}

function validateProposedDeliveries(deliveries: ProposedDelivery[], deliveryKeys: Set<string>): CoreResult<void, InvalidPlanOutputError> {
	for (const delivery of deliveries) {
		const slices = validateProposedDeliverySlices(delivery)
		if (!slices.ok) return slices
		const dependencies = validateProposedDeliveryDependencies(delivery, deliveryKeys)
		if (!dependencies.ok) return dependencies
	}
	return { ok: true, value: undefined }
}

function validateProposedDeliverySlices(delivery: ProposedDelivery): CoreResult<void, InvalidPlanOutputError> {
	if (delivery.slices.length === 0)
		return invalidPlanOutput({ reason: 'delivery-without-slices', proposedDeliveryKey: delivery.proposedDeliveryKey })

	const sliceKeys = new Set<string>()
	for (const slice of delivery.slices) {
		if (sliceKeys.has(slice.proposedSliceKey))
			return invalidPlanOutput({ reason: 'duplicate-proposed-slice-key', proposedSliceKey: slice.proposedSliceKey })
		sliceKeys.add(slice.proposedSliceKey)
	}
	return validateProposedSliceDependencies(delivery, sliceKeys)
}

function validateProposedSliceDependencies(delivery: ProposedDelivery, sliceKeys: Set<string>): CoreResult<void, InvalidPlanOutputError> {
	for (const slice of delivery.slices) {
		for (const dependency of slice.dependsOnProposedSliceKeys) {
			if (!sliceKeys.has(dependency)) return invalidPlanOutput({ reason: 'unknown-proposed-slice-key', proposedSliceKey: dependency })
		}
	}
	return { ok: true, value: undefined }
}

function validateProposedDeliveryDependencies(
	delivery: ProposedDelivery,
	deliveryKeys: Set<string>,
): CoreResult<void, InvalidPlanOutputError> {
	for (const dependency of delivery.dependsOnProposedDeliveryKeys) {
		if (!deliveryKeys.has(dependency))
			return invalidPlanOutput({ reason: 'unknown-proposed-delivery-key', proposedDeliveryKey: dependency })
	}
	return { ok: true, value: undefined }
}

async function validateDeliveryTargets(
	storage: CoreStorage,
	context: PlanProposalContext,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	for (const delivery of context.output.proposedDeliveries) {
		const repository = await getRequired('repository', storage, delivery.target.repositoryId)
		if (!repository.ok) return repository
		if (repository.value.projectId !== context.projectId) {
			return invalidPlanOutput({
				reason: 'repository-project-mismatch',
				proposedDeliveryKey: delivery.proposedDeliveryKey,
				repositoryId: repository.value.id,
			})
		}
	}
	return { ok: true, value: undefined }
}

function uniqueProposedDeliveryKeys(deliveries: ProposedDelivery[]): CoreResult<Set<string>, InvalidPlanOutputError> {
	return uniqueKeys(
		deliveries.map((delivery) => delivery.proposedDeliveryKey),
		'duplicate-proposed-delivery-key',
	)
}

function uniqueProposedMemoryKeys(memories: ProposedMemory[]): CoreResult<Set<string>, InvalidPlanOutputError> {
	return uniqueKeys(
		memories.map((memory) => memory.proposedMemoryKey),
		'duplicate-proposed-memory-key',
	)
}

function uniqueKeys(
	keys: string[],
	reason: 'duplicate-proposed-delivery-key' | 'duplicate-proposed-memory-key',
): CoreResult<Set<string>, InvalidPlanOutputError> {
	const seen = new Set<string>()
	for (const key of keys) {
		if (seen.has(key)) return duplicateKeyError(reason, key)
		seen.add(key)
	}
	return { ok: true, value: seen }
}

function duplicateKeyError(
	reason: 'duplicate-proposed-delivery-key' | 'duplicate-proposed-memory-key',
	key: string,
): CoreResult<never, InvalidPlanOutputError> {
	return reason === 'duplicate-proposed-delivery-key'
		? invalidPlanOutput({ reason, proposedDeliveryKey: key })
		: invalidPlanOutput({ reason, proposedMemoryKey: key })
}

function buildMaterializedPlanOutput(
	runtime: CoreRuntime,
	context: PlanProposalContext,
	stamp: AuditStamp,
): CoreResult<MaterializedPlanOutput, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
	const builder = new PlanOutputBuilder(runtime, context, stamp)
	return builder.build()
}

class PlanOutputBuilder {
	readonly #deliveryIds = new Map<string, Id>()
	readonly #sliceIds = new Map<string, Id>()
	readonly #memoryIds = new Map<string, Id>()
	readonly #deliveries: Delivery[] = []
	readonly #slices: Slice[] = []
	readonly #memories: Memory[] = []
	readonly #memoryRevisions: MemoryRevision[] = []
	readonly #links: Link[] = []

	constructor(
		private readonly runtime: CoreRuntime,
		private readonly context: PlanProposalContext,
		private readonly stamp: AuditStamp,
	) {}

	build(): CoreResult<MaterializedPlanOutput, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
		const deliveries = this.buildDeliveries()
		if (!deliveries.ok) return deliveries

		const memories = this.buildMemories()
		if (!memories.ok) return memories

		const links = this.buildLinks()
		return links.ok ? { ok: true, value: this.output() } : links
	}

	private buildDeliveries(): CoreResult<void, InvalidCoreServiceOutputError> {
		for (const proposed of this.context.output.proposedDeliveries) {
			const deliveryId = nextId(this.runtime.values, 'delivery')
			if (!deliveryId.ok) return deliveryId
			this.#deliveryIds.set(proposed.proposedDeliveryKey, deliveryId.value)
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
			const slices = this.buildSlices(proposed, deliveryId.value)
			if (!slices.ok) return slices
		}
		return { ok: true, value: undefined }
	}

	private buildSlices(proposed: ProposedDelivery, deliveryId: Id): CoreResult<void, InvalidCoreServiceOutputError> {
		for (const [order, proposedSlice] of proposed.slices.entries()) {
			const sliceId = nextId(this.runtime.values, 'slice')
			if (!sliceId.ok) return sliceId
			this.#sliceIds.set(proposedSlice.proposedSliceKey, sliceId.value)
			this.#slices.push({
				id: sliceId.value,
				deliveryId,
				order,
				title: proposedSlice.title,
				instruction: proposedSlice.instruction,
				accepted: this.stamp,
			})
		}
		return { ok: true, value: undefined }
	}

	private buildMemories(): CoreResult<void, InvalidCoreServiceOutputError> {
		for (const proposed of this.context.output.proposedMemories) {
			const memoryId = nextId(this.runtime.values, 'memory')
			if (!memoryId.ok) return memoryId
			const revisionId = nextId(this.runtime.values, 'memory-revision')
			if (!revisionId.ok) return revisionId
			this.#memoryIds.set(proposed.proposedMemoryKey, memoryId.value)
			const currentRevision = { id: revisionId.value, title: proposed.title, body: proposed.body, created: this.stamp }
			this.#memories.push({ id: memoryId.value, parentId: null, currentRevision, created: this.stamp })
			this.#memoryRevisions.push({ ...currentRevision, memoryId: memoryId.value })
		}
		return { ok: true, value: undefined }
	}

	private buildLinks(): CoreResult<void, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
		const dependencies = this.buildDependencyLinks()
		if (!dependencies.ok) return dependencies

		return this.buildMemoryLinks()
	}

	private buildDependencyLinks(): CoreResult<void, InvalidCoreServiceOutputError> {
		for (const delivery of this.context.output.proposedDeliveries) {
			const deliveryLinks = this.buildDeliveryDependencyLinks(delivery)
			if (!deliveryLinks.ok) return deliveryLinks
			const sliceLinks = this.buildSliceDependencyLinks(delivery)
			if (!sliceLinks.ok) return sliceLinks
		}
		return { ok: true, value: undefined }
	}

	private buildDeliveryDependencyLinks(delivery: ProposedDelivery): CoreResult<void, InvalidCoreServiceOutputError> {
		const existing = this.buildExistingDeliveryDependencyLinks(delivery)
		return existing.ok ? this.buildProposedDeliveryDependencyLinks(delivery) : existing
	}

	private buildExistingDeliveryDependencyLinks(delivery: ProposedDelivery): CoreResult<void, InvalidCoreServiceOutputError> {
		const from = this.#deliveryIds.get(delivery.proposedDeliveryKey)!
		for (const to of delivery.dependsOnDeliveryIds) {
			const link = this.pushLink('depends-on', { type: 'delivery', id: from }, { type: 'delivery', id: to })
			if (!link.ok) return link
		}
		return { ok: true, value: undefined }
	}

	private buildProposedDeliveryDependencyLinks(delivery: ProposedDelivery): CoreResult<void, InvalidCoreServiceOutputError> {
		const from = this.#deliveryIds.get(delivery.proposedDeliveryKey)!
		for (const dependency of delivery.dependsOnProposedDeliveryKeys) {
			const link = this.pushLink(
				'depends-on',
				{ type: 'delivery', id: from },
				{ type: 'delivery', id: this.#deliveryIds.get(dependency)! },
			)
			if (!link.ok) return link
		}
		return { ok: true, value: undefined }
	}

	private buildSliceDependencyLinks(delivery: ProposedDelivery): CoreResult<void, InvalidCoreServiceOutputError> {
		for (const slice of delivery.slices) {
			for (const dependency of slice.dependsOnProposedSliceKeys) {
				const link = this.pushLink(
					'depends-on',
					{ type: 'slice', id: this.#sliceIds.get(slice.proposedSliceKey)! },
					{ type: 'slice', id: this.#sliceIds.get(dependency)! },
				)
				if (!link.ok) return link
			}
		}
		return { ok: true, value: undefined }
	}

	private buildMemoryLinks(): CoreResult<void, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
		for (const memory of this.context.output.proposedMemories) {
			const links = this.buildLinksForMemory(memory)
			if (!links.ok) return links
		}
		return { ok: true, value: undefined }
	}

	private buildLinksForMemory(memory: ProposedMemory): CoreResult<void, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
		const produced = this.buildMemoryProvenanceLink(memory)
		return produced.ok ? this.buildMemoryReferenceLinks(memory) : produced
	}

	private buildMemoryProvenanceLink(memory: ProposedMemory): CoreResult<void, InvalidCoreServiceOutputError> {
		return this.pushLink(
			'produced',
			{ type: 'plan', id: this.context.planId },
			{ type: 'memory', id: this.#memoryIds.get(memory.proposedMemoryKey)! },
		)
	}

	private buildMemoryReferenceLinks(memory: ProposedMemory): CoreResult<void, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
		const memoryId = this.#memoryIds.get(memory.proposedMemoryKey)!
		for (const proposedLink of memory.links) {
			const link = this.buildMemoryReferenceLink(memoryId, proposedLink)
			if (!link.ok) return link
		}
		return { ok: true, value: undefined }
	}

	private buildMemoryReferenceLink(
		memoryId: Id,
		proposedLink: ProposedMemory['links'][number],
	): CoreResult<void, InvalidCoreServiceOutputError | InvalidPlanOutputError> {
		const target = this.graphRef(proposedLink.to)
		return target.ok ? this.pushLink(proposedLink.type, { type: 'memory', id: memoryId }, target.value) : target
	}

	private graphRef(ref: ProposedGraphRef): CoreResult<GraphNodeRef, InvalidPlanOutputError> {
		switch (ref.type) {
			case 'existing':
				return { ok: true, value: ref.node }
			case 'proposed-delivery':
				return this.proposedRef('delivery', this.#deliveryIds, ref.proposedDeliveryKey)
			case 'proposed-slice':
				return this.proposedRef('slice', this.#sliceIds, ref.proposedSliceKey)
			case 'proposed-memory':
				return this.proposedRef('memory', this.#memoryIds, ref.proposedMemoryKey)
			default:
				throw new Error(`Unexpected Proposed Graph Reference type: ${String(ref satisfies never)}`)
		}
	}

	private proposedRef(type: GraphNodeRef['type'], ids: Map<string, Id>, key: string): CoreResult<GraphNodeRef, InvalidPlanOutputError> {
		const id = ids.get(key)
		return id === undefined ? unknownProposedRef(type, key) : { ok: true, value: { type, id } }
	}

	private pushLink(type: Link['type'], from: GraphNodeRef, to: GraphNodeRef): CoreResult<void, InvalidCoreServiceOutputError> {
		const id = nextId(this.runtime.values, 'link')
		if (!id.ok) return id
		this.#links.push({ id: id.value, type, from, to, created: this.stamp, archivePeriods: [] })
		return { ok: true, value: undefined }
	}

	private output(): MaterializedPlanOutput {
		return {
			deliveries: this.#deliveries,
			slices: this.#slices,
			memories: this.#memories,
			memoryRevisions: this.#memoryRevisions,
			links: this.#links,
		}
	}
}

async function storeMaterializedPlanOutput(
	storage: CoreStorage,
	output: MaterializedPlanOutput,
): Promise<CoreResult<Omit<MaterializedPlanOutput, 'memoryRevisions'>, Exclude<Error, InvalidInputError>>> {
	const stored = await storeMaterializedRecords(storage, output)
	return stored.ok
		? { ok: true, value: { deliveries: output.deliveries, slices: output.slices, memories: output.memories, links: output.links } }
		: stored
}

async function storeMaterializedRecords(
	storage: CoreStorage,
	output: MaterializedPlanOutput,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const results = [
		await storeRecordSet('delivery', storage, output.deliveries),
		await storeRecordSet('slice', storage, output.slices),
		await storeRecordSet('memory', storage, output.memories),
		await storeRecordSet('memory-revision', storage, output.memoryRevisions),
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

function firstFailure<TError>(results: Array<CoreResult<unknown, TError>>): CoreResult<never, TError> | null {
	return results.find((result): result is CoreResult<never, TError> => !result.ok) ?? null
}

function unknownProposedRef(type: GraphNodeRef['type'], key: string): CoreResult<never, InvalidPlanOutputError> {
	if (type === 'delivery') return invalidPlanOutput({ reason: 'unknown-proposed-delivery-key', proposedDeliveryKey: key })
	if (type === 'slice') return invalidPlanOutput({ reason: 'unknown-proposed-slice-key', proposedSliceKey: key })
	return invalidPlanOutput({ reason: 'unknown-proposed-memory-key', proposedMemoryKey: key })
}

function invalidPlanOutput(error: InvalidPlanOutputFields): CoreResult<never, InvalidPlanOutputError> {
	return { ok: false, error: { type: 'invalid-plan-output', ...error } as InvalidPlanOutputError }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, seedProject, seedSelectableModel, stamp } =
		await import('../utils/test-helpers')

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

		it('accepts a pending Plan proposal event and materializes facts', async () => {
			const options = proposalFixture()
			const command = createAcceptPlanOutputCommand(createTestCoreRuntime(options))

			const result = await command({ proposalEventId: 'proposal-event' }, context)

			expect(result).toMatchObject({
				ok: true,
				value: {
					deliveries: [{ id: 'delivery-1', projectId: 'project-1', planId: 'plan-1', title: 'Delivery' }],
					slices: [{ id: 'slice-1', deliveryId: 'delivery-1', title: 'Slice' }],
					memories: [{ id: 'memory-1', currentRevision: { id: 'memory-revision-1', title: 'Memory' } }],
					acceptedEvent: { body: { type: 'proposal-accepted', proposalEventId: 'proposal-event' } },
				},
			})
			expect(options.tx.deliveries.records.get('delivery-1')).toMatchObject({ title: 'Delivery' })
			expect(options.tx.slices.records.get('slice-1')).toMatchObject({ title: 'Slice' })
			expect(options.tx.memories.records.get('memory-1')).toMatchObject({ currentRevision: { title: 'Memory' } })
			expect(options.tx.agentRunEvents.records.get('agent-run-event-1')?.body).toMatchObject({ type: 'proposal-accepted' })
		})

		it('rejects reviewed, wrong-type, and wrong-purpose proposals', async () => {
			const reviewed = proposalFixture()
			reviewed.tx.agentRunEvents.records.set('review-event', {
				id: 'review-event',
				agentRunId: 'agent-run-1',
				sequence: 2,
				occurred: { at: stamp.at },
				body: {
					type: 'proposal-rejected',
					proposalEventId: 'proposal-event',
					authorized: stamp,
					reason: null,
				},
			})
			await expect(
				createAcceptPlanOutputCommand(createTestCoreRuntime(reviewed))({ proposalEventId: 'proposal-event' }, context),
			).resolves.toEqual({
				ok: false,
				error: { type: 'proposal-already-reviewed', proposalEventId: 'proposal-event' },
			})

			const wrongType = proposalFixture('proposed-revision-output')
			await expect(
				createAcceptPlanOutputCommand(createTestCoreRuntime(wrongType))({ proposalEventId: 'proposal-event' }, context),
			).resolves.toEqual({
				ok: false,
				error: {
					type: 'proposal-type-mismatch',
					proposalEventId: 'proposal-event',
					expected: 'proposed-plan-output',
					actual: 'proposed-revision-output',
				},
			})

			const wrongPurpose = proposalFixture()
			wrongPurpose.tx.agentRuns.records.get('agent-run-1')!.purpose = { type: 'revision-planning', revisionGateId: 'revision-gate-1' }
			await expect(
				createAcceptPlanOutputCommand(createTestCoreRuntime(wrongPurpose))({ proposalEventId: 'proposal-event' }, context),
			).resolves.toMatchObject({
				ok: false,
				error: { type: 'agent-run-purpose-mismatch', agentRunId: 'agent-run-1' },
			})
		})
	})

	function proposalFixture(type: 'proposed-plan-output' | 'proposed-revision-output' = 'proposed-plan-output') {
		const options = createTestCoreServices()
		seedProject(options.tx, 'project-1')
		seedSelectableModel(options.tx, 'model-1')
		options.tx.repositories.records.set('repository-1', {
			id: 'repository-1',
			projectId: 'project-1',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
			created: stamp,
		})
		options.tx.plans.records.set('plan-1', {
			id: 'plan-1',
			projectId: 'project-1',
			title: 'Plan',
			config: null,
			created: stamp,
			closed: null,
		})
		options.tx.agentRuns.records.set('agent-run-1', {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: 'plan-1' },
			started: { at: stamp.at },
			completed: null,
		})
		options.tx.agentRunEvents.records.set('proposal-event', proposalEvent(type))
		return options
	}

	function proposalEvent(type: 'proposed-plan-output' | 'proposed-revision-output'): AgentRunEvent {
		return {
			id: 'proposal-event',
			agentRunId: 'agent-run-1',
			sequence: 1,
			occurred: { at: stamp.at },
			body:
				type === 'proposed-plan-output'
					? { type, toolCallScheduledEventId: 'tool-call-1', output: planProposal() }
					: {
							type,
							toolCallScheduledEventId: 'tool-call-1',
							output: { instruction: { body: 'Revise.' }, disposition: { body: 'Because.' } },
						},
		}
	}

	function planProposal(): PlanOutputProposal {
		return {
			proposedDeliveries: [
				{
					proposedDeliveryKey: 'delivery-a',
					title: 'Delivery',
					target: { type: 'source-control', repositoryId: 'repository-1', targetBranch: 'main' },
					slices: [
						{
							proposedSliceKey: 'slice-a',
							title: 'Slice',
							instruction: { body: 'Do work.' },
							dependsOnProposedSliceKeys: [],
						},
					],
					dependsOnDeliveryIds: [],
					dependsOnProposedDeliveryKeys: [],
				},
			],
			proposedMemories: [{ proposedMemoryKey: 'memory-a', title: 'Memory', body: 'Remember this.', links: [] }],
		}
	}
}
