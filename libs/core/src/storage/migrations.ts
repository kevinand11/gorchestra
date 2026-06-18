import type { AnyMigration, CreateTableChange, FieldSpec, OrmAdapter } from 'equipped/orm'

type CoreCreateTableChange = CreateTableChange<OrmAdapter>
type CoreFieldSpec = FieldSpec<OrmAdapter>

export const coreStorageMigrations = [
	{
		id: '2026-06-16-0001-create-core-storage',
		tx: true,
		changes: [
			createTable('portfolio_config', [objectField('configured'), objectField('value')]),
			createTable('projects', [stringField('title'), objectField('source'), nullableObjectField('config'), objectField('created')]),
			createTable('repositories', [stringField('projectId'), objectField('config'), objectField('created')]),
			createTable('model_providers', [
				stringField('name'),
				stringField('protocol'),
				stringField('baseUrl'),
				nullableObjectField('auth'),
				arrayField('headers'),
				objectField('created'),
				nullableObjectField('updated'),
				arrayField('archivePeriods'),
			]),
			createTable('models', [
				stringField('providerId'),
				stringField('name'),
				stringField('providerModelId'),
				objectField('created'),
				nullableObjectField('updated'),
				arrayField('archivePeriods'),
			]),
			createTable('plans', [stringField('projectId'), stringField('title'), nullableObjectField('config'), objectField('created')]),
			createTable('deliveries', [
				stringField('projectId'),
				stringField('planId'),
				stringField('title'),
				objectField('target'),
				nullableObjectField('config'),
				objectField('accepted'),
				nullableObjectField('queued'),
				nullableObjectField('closed'),
			]),
			createTable('slices', [
				stringField('deliveryId'),
				numberField('order'),
				stringField('title'),
				objectField('instruction'),
				objectField('accepted'),
			]),
			createTable('links', [
				stringField('type'),
				objectField('from'),
				objectField('to'),
				objectField('created'),
				arrayField('archivePeriods'),
			]),
			createTable('memories', [stringField('title'), stringField('body'), nullableStringField('type'), objectField('created')]),
			createTable('delivery_artifacts', [stringField('deliveryId'), objectField('config'), objectField('created')]),
			createTable('slice_artifacts', [stringField('sliceId'), objectField('config'), objectField('created')]),
			createTable('actions', [
				stringField('deliveryId'),
				objectField('performed'),
				nullableObjectField('authorized'),
				objectField('result'),
			]),
			createTable('agent_runs', [
				objectField('agent'),
				objectField('purpose'),
				objectField('started'),
				nullableObjectField('completed'),
			]),
			createTable('review_surfaces', [
				objectField('scope'),
				objectField('config'),
				stringField('title'),
				nullableObjectField('closed'),
				objectField('created'),
			]),
			createTable('revision_gates', [
				objectField('scope'),
				stringField('reviewSurfaceId'),
				objectField('opened'),
				nullableObjectField('closed'),
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
				nullableObjectField('replaced'),
				arrayField('archivePeriods'),
			]),
			createTable('secret_bindings', [
				stringField('secretId'),
				objectField('scope'),
				stringField('envName'),
				objectField('created'),
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

function nullableStringField(name: string): CoreFieldSpec {
	return { ...stringField(name), nullable: true }
}

function numberField(name: string): CoreFieldSpec {
	return { name, type: 'number' }
}

function objectField(name: string): CoreFieldSpec {
	return { name, type: 'object' }
}

function nullableObjectField(name: string): CoreFieldSpec {
	return { ...objectField(name), nullable: true }
}

function arrayField(name: string): CoreFieldSpec {
	return { name, type: 'array' }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { coreStorageSchemas } = await import('./schemas')

	describe('Core storage migrations', () => {
		it('creates every Core storage schema table in the baseline migration', () => {
			const baseline = coreStorageMigrations[0]
			const createdTables = baseline.changes
				.filter((change) => change.kind === 'createTable')
				.map((change) => change.name)
				.sort()

			expect(createdTables).toEqual(coreStorageSchemas.map((schema) => schema.name).sort())
		})
	})
}
