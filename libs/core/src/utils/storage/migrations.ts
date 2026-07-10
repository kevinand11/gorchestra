import type { AnyMigration, AnySchemaField, CreateTableChange, FieldSpec, OrmAdapter } from 'equipped/orm'
import type { JsonSchema } from 'valleyed'

type CoreCreateTableChange = CreateTableChange<OrmAdapter>
type CoreFieldSpec = FieldSpec<OrmAdapter>

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
] as const satisfies readonly AnyMigration[]

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
	const { v } = await import('valleyed')
	const { coreStorageSchemas } = await import('./schema-registry')

	describe('Core storage migrations', () => {
		it('matches every registered schema field in the disposable baseline', () => {
			const baselineChanges = coreStorageMigrations[0].changes
			expect(baselineChanges.every((change) => change.kind === 'createTable')).toBe(true)

			const baselineTables = baselineChanges
				.filter((change): change is CoreCreateTableChange => change.kind === 'createTable')
				.map(normalizeCreateTable)
				.sort((left, right) => left.name.localeCompare(right.name))
			// Equipped's diffSchemas projection cannot currently inspect every piped Valleyed field,
			// so normalize the same metadata through Valleyed's public JSON Schema API.
			const schemaTables = coreStorageSchemas.map(normalizeSchema).sort((left, right) => left.name.localeCompare(right.name))

			expect(baselineTables).toEqual(schemaTables)
		})
	})

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
