import type { CreateTableChange, FieldSpec, Migration } from 'equipped/orm'

import type { ServerStorageAdapter } from './adapter'
import { serverStorageSchemas } from './schemas'

type ServerStorageMigration = Migration<ServerStorageAdapter>
type ServerCreateTableChange = CreateTableChange<ServerStorageAdapter>
type ServerFieldSpec = FieldSpec<ServerStorageAdapter>

export const serverStorageMigrations = [
	{
		id: '2026-06-19-0001-create-server-identity-storage',
		tx: true,
		changes: [
			createTable('users', [stringField('createdAt')]),
			createTable('email_authentication_identities', [stringField('userId'), stringField('email'), stringField('createdAt')]),
			{
				kind: 'addIndex',
				table: 'email_authentication_identities',
				on: ['email'],
				unique: true,
				name: 'email_authentication_identities_email_unique',
			},
		],
	},
] as const satisfies readonly ServerStorageMigration[]

function createTable(name: string, fields: ServerFieldSpec[]): ServerCreateTableChange {
	return { kind: 'createTable', name, pk: { name: 'id', type: 'string' }, fields }
}

function stringField(name: string): ServerFieldSpec {
	return { name, type: 'string' }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server storage migrations', () => {
		it('creates every Server storage schema table in the baseline migration', () => {
			const baseline = serverStorageMigrations[0]
			const createdTables = baseline.changes
				.filter((change) => change.kind === 'createTable')
				.map((change) => change.name)
				.sort()

			expect(createdTables).toEqual(serverStorageSchemas.map((schema) => schema.name).sort())
		})
	})
}
