import type { AnyMigration, AnySchemaField, CreateTableChange, FieldSpec, Migration, OrmAdapter, Repo } from 'equipped/orm'
import type { InMemoryAdapter as InMemoryAdapterType } from 'equipped/orm/adapters/in-memory'
import { v, type JsonSchema } from 'valleyed'

import { coreSchema, withExplicitCoreStorageId } from './schema'
import { auditStampPipe, idPipe, runtimeRecordPipe } from '../../domain/commons'
import { dispatchCoordinationId, dispatchCoordinationSchema } from '../../domain/dispatch-coordination'
import type { CoreStorageAdapter } from '../../services'

type CoreCreateTableChange = CreateTableChange<OrmAdapter>
type CoreFieldSpec = FieldSpec<OrmAdapter>

const migrationActionSchema = coreSchema('actions')
	.field('deliveryId', idPipe)
	.field('performed', runtimeRecordPipe)
	.field('authorized', v.nullable(auditStampPipe))
	.field('result', v.record(v.string(), v.any<unknown>()))
	.build()

const legacyDispatchActionTypes = new Set([
	'queue-delivery-work-operation',
	'start-delivery-work-operation',
	'finish-delivery-work-operation',
])

export const coreStorageMigrations = [
	{
		id: '2026-06-16-0001-create-core-storage',
		tx: true,
		changes: [
			createTable('projects', [stringField('title'), objectField('source'), objectField('config'), objectField('created')]),
			createTable('repositories', [stringField('projectId'), objectField('config'), objectField('created')]),
			createTable('model_providers', [
				stringField('name'),
				objectField('source'),
				nullableField(objectField('auth')),
				arrayField('headers'),
				nullableField(objectField('providerOptions')),
				objectField('created'),
				nullableField(objectField('updated')),
				arrayField('archivePeriods'),
			]),
			createTable('models', [
				stringField('providerId'),
				stringField('name'),
				stringField('providerModelId'),
				nullableField(objectField('providerOptions')),
				objectField('capabilities'),
				nullableField(objectField('pricing')),
				objectField('created'),
				nullableField(objectField('updated')),
				arrayField('archivePeriods'),
			]),
			createTable('agent_run_profiles', [
				stringField('name'),
				objectField('modelUse'),
				arrayField('runtimeRequirements'),
				objectField('sandboxConfig'),
				objectField('created'),
				nullableField(objectField('updated')),
				arrayField('archivePeriods'),
			]),
			createTable('plans', [
				stringField('projectId'),
				stringField('agentRunId'),
				stringField('title'),
				objectField('created'),
				nullableField(objectField('closed')),
			]),
			createTable('deliveries', [
				stringField('projectId'),
				stringField('planId'),
				stringField('title'),
				objectField('target'),
				nullableField(objectField('config')),
				objectField('accepted'),
				nullableField(objectField('queued')),
				nullableField(objectField('closed')),
			]),
			createTable('slices', [
				stringField('deliveryId'),
				numberField('order'),
				stringField('title'),
				objectField('instruction'),
				objectField('accepted'),
			]),
			createTable('links', [objectField('def'), objectField('created')]),
			createTable('memories', [nullableField(stringField('parentId')), objectField('currentRevision'), objectField('created')]),
			createTable('memory_revisions', [stringField('memoryId'), stringField('title'), stringField('body'), objectField('created')]),
			createTable('delivery_artifacts', [stringField('deliveryId'), objectField('config'), objectField('created')]),
			createTable('slice_artifacts', [stringField('sliceId'), objectField('config'), objectField('created')]),
			createTable('actions', [
				stringField('deliveryId'),
				objectField('performed'),
				nullableField(objectField('authorized')),
				objectField('result'),
			]),
			createTable('agent_runs', [
				objectField('agent'),
				objectField('purpose'),
				objectField('profile'),
				arrayField('toolSet'),
				nullableField(objectField('modelUseOverride')),
				arrayField('sourceRuntimeRequirements'),
				arrayField('runtimeRequirementOverrides'),
				arrayField('desiredRuntimeRequirements'),
				nullableField(objectField('blocked')),
				nullableField(objectField('sandbox')),
				objectField('started'),
				nullableField(objectField('completed')),
			]),
			createTable('agent_run_events', [stringField('agentRunId'), objectField('occurred'), objectField('body')]),
			createTable('review_surfaces', [
				objectField('scope'),
				objectField('config'),
				stringField('title'),
				nullableField(objectField('closed')),
				objectField('created'),
			]),
			createTable('revision_gates', [
				stringField('agentRunId'),
				objectField('scope'),
				stringField('reviewSurfaceId'),
				objectField('opened'),
				nullableField(objectField('closed')),
			]),
			createTable('revisions', [
				stringField('revisionGateId'),
				objectField('scope'),
				objectField('instruction'),
				objectField('disposition'),
				objectField('accepted'),
			]),
			createTable('secrets', [
				stringField('name'),
				stringField('valueRef'),
				objectField('created'),
				nullableField(objectField('updated')),
				nullableField(objectField('valueReplaced')),
				arrayField('archivePeriods'),
			]),
		],
	},
	{
		id: '2026-07-13-0002-durable-dispatch',
		tx: true,
		changes: [
			createTable('dispatch_requests', [
				objectField('payload'),
				arrayField('reasons'),
				nullableField(objectField('deduplicationKey')),
				arrayField('coordinationClaims'),
				objectField('accepted'),
				numberField('attemptCount'),
				numberField('expiredLeaseCount'),
				arrayField('attempts'),
				objectField('lifecycle'),
			]),
			createTable('dispatch_coordination', [numberField('epoch'), numberField('revision'), numberField('bootstrapVersion')]),
			{ kind: 'execute', up: migrateDurableDispatch },
		],
	},
] as const satisfies readonly AnyMigration[]

async function migrateDurableDispatch<Adapter extends CoreStorageAdapter>(repo: Repo<Adapter>): Promise<void> {
	const existingCoordination = await repo.on(dispatchCoordinationSchema).one().id(dispatchCoordinationId).find()
	if (existingCoordination === null) {
		await withExplicitCoreStorageId(dispatchCoordinationId, () =>
			repo.on(dispatchCoordinationSchema).one().create({ epoch: 0, revision: 0, bootstrapVersion: 0 }),
		)
	}

	const actions = await repo.on(migrationActionSchema).all().find()
	for (const action of actions) {
		if (legacyDispatchActionTypes.has(String(action.result.type))) {
			await repo.on(migrationActionSchema).one().id(action.id).delete()
			continue
		}
		if (!('dispatchStartedActionId' in action.result)) continue
		const result: Record<string, unknown> = { ...action.result, dispatch: null }
		delete result.dispatchStartedActionId
		await repo.on(migrationActionSchema).one().id(action.id).update({ result })
	}
}

function createTable(name: string, fields: CoreFieldSpec[]): CoreCreateTableChange {
	return { kind: 'createTable', name, pk: { name: 'id', type: 'string' }, fields }
}

function stringField(name: string): CoreFieldSpec {
	return { name, type: 'string' }
}

function numberField(name: string): CoreFieldSpec {
	return { name, type: 'number' }
}

function objectField(name: string): CoreFieldSpec {
	return { name, type: 'object' }
}

function nullableField(field: CoreFieldSpec): CoreFieldSpec {
	return { ...field, nullable: true }
}

function arrayField(name: string): CoreFieldSpec {
	return { name, type: 'array' }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { Migrator, Repo } = await import('equipped/orm')
	const { InMemoryAdapter } = await import('equipped/orm/adapters/in-memory')
	const { v } = await import('valleyed')
	const { actionSchema } = await import('../../domain/action')
	const { coreStorageSchemas } = await import('./schema-registry')
	type InMemoryMigration = Migration<InMemoryAdapterType>
	const inMemoryMigrations = coreStorageMigrations as unknown as readonly InMemoryMigration[]

	describe('Core storage migrations', () => {
		it('applies the complete migration chain to fresh storage exactly once', async () => {
			const { adapter, repo } = migrationTestStorage()
			const migrator = Migrator.from(repo, adapter).migrations(inMemoryMigrations).build()

			expect((await migrator.up()).ran).toEqual(['2026-06-16-0001-create-core-storage', '2026-07-13-0002-durable-dispatch'])
			expect((await migrator.up()).ran).toEqual([])
			expect(await repo.on(dispatchCoordinationSchema).all().find()).toEqual([
				{ id: dispatchCoordinationId, epoch: 0, revision: 0, bootstrapVersion: 0 },
			])
		})

		it('applies only durable Dispatch migration when the baseline is recorded', async () => {
			const { adapter, repo } = migrationTestStorage()
			await Migrator.from(repo, adapter).migrations([inMemoryMigrations[0]!]).build().up()

			const result = await Migrator.from(repo, adapter).migrations(inMemoryMigrations).build().up()

			expect(result.ran).toEqual(['2026-07-13-0002-durable-dispatch'])
		})

		it('removes only legacy transient Dispatch Actions', async () => {
			const { adapter, repo } = migrationTestStorage()
			await Migrator.from(repo, adapter).migrations([inMemoryMigrations[0]!]).build().up()
			await withExplicitCoreStorageId('01k00000000000000000000001', () =>
				repo
					.on(migrationActionSchema)
					.one()
					.create({
						deliveryId: '01k00000000000000000000002',
						performed: { at: '2026-07-13T12:00:00.000Z' },
						authorized: null,
						result: { type: 'queue-delivery-work-operation' },
					}),
			)
			await withExplicitCoreStorageId('01k00000000000000000000003', () =>
				repo
					.on(actionSchema)
					.one()
					.create({
						deliveryId: '01k00000000000000000000002',
						performed: { at: '2026-07-13T12:00:00.000Z' },
						authorized: null,
						result: { type: 'validate-preflight', checks: [] },
					}),
			)
			const legacyDurableResults = [
				{ type: 'create-delivery-artifact', deliveryArtifactId: '01k00000000000000000000010' },
				{
					type: 'validate-slice-artifact',
					sliceId: '01k00000000000000000000042',
					evidence: {
						type: 'validation',
						operation: { type: 'slice-branch-validation' },
						passed: true,
						summary: 'Valid.',
					},
				},
				{ type: 'create-delivery-review-surface', reviewSurfaceId: '01k00000000000000000000037' },
				{
					type: 'promote-slice-artifact',
					sliceId: '01k00000000000000000000042',
					evidence: {
						type: 'external-operation',
						operation: { type: 'merge-review-surface' },
						passed: true,
						summary: 'Merged.',
					},
				},
				{
					type: 'observe-delivery-artifact-integration',
					evidence: {
						type: 'external-operation',
						operation: { type: 'observe-artifact-integration' },
						passed: true,
						summary: 'Integrated.',
					},
				},
				{
					type: 'record-delivery-external-operation-failure',
					evidence: {
						type: 'external-operation',
						operation: { type: 'push-branch' },
						passed: false,
						summary: 'Failed.',
					},
				},
			]
			for (const [index, result] of legacyDurableResults.entries()) {
				await withExplicitCoreStorageId(`01k000000000000000000000${String(10 + index).padStart(2, '0')}`, () =>
					repo
						.on(migrationActionSchema)
						.one()
						.create({
							deliveryId: '01k00000000000000000000002',
							performed: { at: '2026-07-13T12:00:00.000Z' },
							authorized: null,
							result: { ...result, dispatchStartedActionId: '01k00000000000000000000009' },
						}),
				)
			}

			await Migrator.from(repo, adapter).migrations(inMemoryMigrations).build().up()

			expect(await repo.on(actionSchema).one().id('01k00000000000000000000001').find()).toBeNull()
			expect(await repo.on(actionSchema).one().id('01k00000000000000000000003').find()).toMatchObject({
				result: { type: 'validate-preflight', checks: [] },
			})
			for (const [index, result] of legacyDurableResults.entries()) {
				expect(
					await repo
						.on(actionSchema)
						.one()
						.id(`01k000000000000000000000${String(10 + index).padStart(2, '0')}`)
						.find(),
				).toMatchObject({ result: { ...result, dispatch: null } })
			}
		})

		it('matches every registered schema field across cumulative create-table changes', () => {
			const migrationTables = coreStorageMigrations
				.flatMap((migration) => migration.changes)
				.filter((change): change is CoreCreateTableChange => change.kind === 'createTable')
				.map(normalizeCreateTable)
				.sort((left, right) => left.name.localeCompare(right.name))
			// Equipped's diffSchemas projection cannot currently inspect every piped Valleyed field,
			// so normalize the same metadata through Valleyed's public JSON Schema API.
			const schemaTables = coreStorageSchemas.map(normalizeSchema).sort((left, right) => left.name.localeCompare(right.name))

			expect(migrationTables).toEqual(schemaTables)
		})
	})

	function migrationTestStorage() {
		const adapter = InMemoryAdapter.create({})
		const repo = Repo.from(adapter)
			.resolve((schema) => ({ table: schema.name }))
			.build()
		return { adapter, repo }
	}

	function normalizeCreateTable(change: CoreCreateTableChange) {
		return {
			name: change.name,
			pk: normalizeField(change.pk),
			fields: change.fields.map(normalizeField).sort((left, right) => left.name.localeCompare(right.name)),
		}
	}

	function normalizeSchema(schema: (typeof coreStorageSchemas)[number]) {
		return {
			name: schema.name,
			pk: normalizeSchemaField(schema.pkField),
			fields: Object.values(schema.fieldDefs)
				.map(normalizeSchemaField)
				.sort((left, right) => left.name.localeCompare(right.name)),
		}
	}

	function normalizeSchemaField(field: AnySchemaField) {
		const type = inferJsonSchemaType(v.schema(field.pipe))
		if (type === null) throw new Error(`Expected storage field ${field.name} to have an inferable storage type.`)

		return { name: field.name, type, nullable: v.validate(field.pipe, null).valid }
	}

	function inferJsonSchemaType(schema: JsonSchema): CoreFieldSpec['type'] | null {
		if (schema.type === 'integer') return 'number'
		if (isCoreFieldType(schema.type)) return schema.type
		if ('items' in schema) return 'array'
		if ('properties' in schema) return 'object'
		for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
			const branches = schema[key]
			if (!Array.isArray(branches)) continue

			const branchSchemas = branches.filter((branch): branch is JsonSchema => typeof branch === 'object' && branch !== null)
			if (branchSchemas.length !== branches.length) return null

			const nonNullTypes = branchSchemas.filter((branch) => branch.type !== 'null').map(inferJsonSchemaType)
			if (nonNullTypes.some((type) => type === null)) return null

			const types = new Set(nonNullTypes)
			if (types.size === 1) return [...types][0] ?? null
		}
		return null
	}

	function isCoreFieldType(value: unknown): value is CoreFieldSpec['type'] {
		return ['string', 'number', 'boolean', 'array', 'object', 'date'].includes(String(value))
	}

	function normalizeField(field: CoreFieldSpec) {
		return { name: field.name, type: field.type, nullable: field.nullable ?? false }
	}
}
