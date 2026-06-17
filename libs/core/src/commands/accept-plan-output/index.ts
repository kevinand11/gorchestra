import { v, type PipeOutput } from 'valleyed'

import { materializePlanOutput } from './materialize'
import { prepareMaterializationPlan } from './prepare'
import type { MaterializedPlanOutput } from './types'
import { idPipe, type OperationContext } from '../../domain/commons'
import type { Delivery } from '../../domain/delivery'
import type { Link } from '../../domain/graph'
import type { Memory } from '../../domain/memory'
import { planOutputProposalPipe } from '../../domain/plan'
import type { Slice } from '../../domain/slice'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvalidPlanOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../../errors'
import type { CoreRuntime } from '../../runtime'
import type { CoreStorage } from '../../services'
import { buildCommandHandler } from '../../utils/command'
import { auditStamp, createRecord, getRequired, listRecords, withTransaction } from '../../utils/command-storage'
import type { Result as CoreResult } from '../../utils/types'

const acceptPlanOutputInputPipe = v.object({ planId: idPipe, output: planOutputProposalPipe })
export type Input = PipeOutput<typeof acceptPlanOutputInputPipe>

export interface Result {
	deliveries: Delivery[]
	slices: Slice[]
	memories: Memory[]
	links: Link[]
}

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| InvariantViolationError
	| StorageOperationFailedError
	| InvalidPlanOutputError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createAcceptPlanOutputCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('acceptPlanOutput', acceptPlanOutputInputPipe, (input, context) =>
		handleAcceptPlanOutput(runtime, input, context),
	)
}

async function handleAcceptPlanOutput(
	runtime: CoreRuntime,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const stamp = auditStamp(runtime.values, context)
	if (!stamp.ok) return stamp

	return withTransaction(runtime.services, (storage) => acceptPlanOutput(storage, runtime, input, stamp.value))
}

async function acceptPlanOutput(
	storage: CoreStorage,
	runtime: CoreRuntime,
	input: Input,
	stamp: Parameters<typeof prepareMaterializationPlan>[2],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const plan = await getRequired('plan', storage, input.planId)
	return plan.ok ? acceptLoadedPlan(storage, runtime, input, stamp, plan.value) : plan
}

async function acceptLoadedPlan(
	storage: CoreStorage,
	runtime: CoreRuntime,
	input: Input,
	stamp: Parameters<typeof prepareMaterializationPlan>[2],
	plan: Parameters<typeof prepareMaterializationPlan>[1],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const existing = await existingRefs(storage)
	if (!existing.ok) return existing

	return acceptWithExistingRefs(storage, runtime, input, stamp, plan, existing.value)
}

async function acceptWithExistingRefs(
	storage: CoreStorage,
	runtime: CoreRuntime,
	input: Input,
	stamp: Parameters<typeof prepareMaterializationPlan>[2],
	plan: Parameters<typeof prepareMaterializationPlan>[1],
	existing: Parameters<typeof prepareMaterializationPlan>[4],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const materializationPlan = prepareMaterializationPlan(runtime.values, plan, stamp, input.output, existing)
	if (!materializationPlan.ok) return materializationPlan

	const records = materializePlanOutput(materializationPlan.value)
	const writeResult = await writeMaterializedPlanOutput(storage, records)
	return writeResult.ok ? { ok: true, value: records } : writeResult
}

async function existingRefs(
	storage: CoreStorage,
): Promise<CoreResult<Parameters<typeof prepareMaterializationPlan>[4], Exclude<Error, InvalidInputError>>> {
	const repositories = await listRecords('repository', storage)
	const deliveries = await listRecords('delivery', storage)
	const slices = await listRecords('slice', storage)
	const memories = await listRecords('memory', storage)
	const plans = await listRecords('plan', storage)
	const links = await listRecords('link', storage)
	const failure = firstFailure([repositories, deliveries, slices, memories, plans, links])
	if (failure !== null) return failure

	return {
		ok: true,
		value: {
			repositories: resultValue(repositories),
			deliveries: resultValue(deliveries),
			slices: resultValue(slices),
			memories: resultValue(memories),
			plans: resultValue(plans),
			links: resultValue(links),
		},
	}
}

async function writeMaterializedPlanOutput(
	storage: CoreStorage,
	records: MaterializedPlanOutput,
): Promise<CoreResult<void, InvalidCoreServiceOutputError | StorageOperationFailedError | InvariantViolationError>> {
	return firstFailedWrite([
		() => writeMany(records.deliveries, (delivery) => createRecord('delivery', storage, delivery)),
		() => writeMany(records.slices, (slice) => createRecord('slice', storage, slice)),
		() => writeMany(records.memories, (memory) => createRecord('memory', storage, memory)),
		() => writeMany(records.links, (link) => createRecord('link', storage, link)),
	])
}

async function firstFailedWrite(
	writes: Array<
		() => Promise<CoreResult<unknown, InvalidCoreServiceOutputError | StorageOperationFailedError | InvariantViolationError>>
	>,
): Promise<CoreResult<void, InvalidCoreServiceOutputError | StorageOperationFailedError | InvariantViolationError>> {
	for (const write of writes) {
		const result = await write()
		if (!result.ok) return result
	}

	return { ok: true, value: undefined }
}

async function writeMany<TRecord>(
	records: TRecord[],
	write: (
		record: TRecord,
	) => Promise<CoreResult<unknown, InvalidCoreServiceOutputError | StorageOperationFailedError | InvariantViolationError>>,
): Promise<CoreResult<void, InvalidCoreServiceOutputError | StorageOperationFailedError | InvariantViolationError>> {
	for (const record of records) {
		const result = await write(record)
		if (!result.ok) return result
	}

	return { ok: true, value: undefined }
}

function firstFailure<TError>(results: Array<CoreResult<unknown, TError>>): CoreResult<never, TError> | null {
	const failure = results.find((result) => !result.ok)
	return failure === undefined || failure.ok ? null : { ok: false, error: failure.error }
}

function resultValue<TValue>(result: CoreResult<TValue, unknown>): TValue {
	if (!result.ok) throw new Error('Expected successful result.')

	return result.value
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedProject, seedSecret } =
		await import('../../utils/test-helpers')
	const { createCreatePlanCommand } = await import('../create-plan')
	const { createCreateRepositoryCommand } = await import('../create-repository')

	describe('acceptPlanOutput command', () => {
		it('validates input before reading storage', async () => {
			const command = createAcceptPlanOutputCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'acceptPlanOutput' },
			})
		})

		it('materializes deliveries, ordered slices, memories, dependencies, and Plan-produced Memory links', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			seedSecret(options.tx, 'secret-1')
			await createCreatePlanCommand(createTestCoreRuntime(options))({ projectId: 'project-1', title: 'Plan', config: null }, context)
			await createCreateRepositoryCommand(createTestCoreRuntime(options))(
				{ projectId: 'project-1', config: { provider: 'github', owner: 'Org', name: 'Repo', secretId: 'secret-1' } },
				context,
			)
			const command = createAcceptPlanOutputCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					planId: 'plan-1',
					output: {
						proposedDeliveries: [
							{
								proposedDeliveryKey: 'api',
								title: 'Build API',
								target: { type: 'source-control', repositoryId: 'repository-1', targetBranch: 'main' },
								dependsOnDeliveryIds: [],
								dependsOnProposedDeliveryKeys: [],
								slices: [
									{
										proposedSliceKey: 'schema',
										title: 'Schema',
										instruction: { body: 'Build schema.' },
										dependsOnProposedSliceKeys: [],
									},
									{
										proposedSliceKey: 'route',
										title: 'Route',
										instruction: { body: 'Build route.' },
										dependsOnProposedSliceKeys: ['schema'],
									},
								],
							},
						],
						proposedMemories: [
							{
								proposedMemoryKey: 'constraint',
								title: 'Constraint',
								body: 'Use existing style.',
								type: 'constraint',
								links: [{ type: 'supports', to: { type: 'proposed-delivery', proposedDeliveryKey: 'api' } }],
							},
						],
					},
				},
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					deliveries: [
						{
							id: 'delivery-1',
							projectId: 'project-1',
							planId: 'plan-1',
							title: 'Build API',
							target: { type: 'source-control', repositoryId: 'repository-1', targetBranch: 'main' },
							config: null,
							accepted: localStamp(),
							queued: null,
							closed: null,
						},
					],
					slices: [
						{
							id: 'slice-1',
							deliveryId: 'delivery-1',
							order: 0,
							title: 'Schema',
							instruction: { body: 'Build schema.' },
							accepted: localStamp(),
						},
						{
							id: 'slice-2',
							deliveryId: 'delivery-1',
							order: 1,
							title: 'Route',
							instruction: { body: 'Build route.' },
							accepted: localStamp(),
						},
					],
					memories: [
						{ id: 'memory-1', title: 'Constraint', body: 'Use existing style.', type: 'constraint', created: localStamp() },
					],
					links: [
						{
							id: 'link-1',
							type: 'depends-on',
							from: { type: 'slice', id: 'slice-2' },
							to: { type: 'slice', id: 'slice-1' },
							created: localStamp(),
							archivePeriods: [],
						},
						{
							id: 'link-2',
							type: 'supports',
							from: { type: 'memory', id: 'memory-1' },
							to: { type: 'delivery', id: 'delivery-1' },
							created: localStamp(),
							archivePeriods: [],
						},
						{
							id: 'link-3',
							type: 'produced',
							from: { type: 'plan', id: 'plan-1' },
							to: { type: 'memory', id: 'memory-1' },
							created: localStamp(),
							archivePeriods: [],
						},
					],
				},
			})
		})
	})
}
