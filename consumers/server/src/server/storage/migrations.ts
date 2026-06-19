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
			addUniqueIndex('email_authentication_identities', ['email'], 'email_authentication_identities_email_unique'),
		],
	},
	{
		id: '2026-06-19-0002-create-server-workspace-registry',
		tx: true,
		changes: [
			createTable('workspaces', [stringField('displayName'), stringField('createdAt')]),
			createTable('workspace_members', [
				stringField('workspaceId'),
				stringField('userId'),
				stringField('membershipStartedAt'),
				nullableStringField('membershipEndedAt'),
			]),
			createTable('workspace_owner_roles', [
				stringField('workspaceId'),
				stringField('workspaceMemberId'),
				stringField('assignedAt'),
				nullableStringField('revokedAt'),
			]),
			createTable('portfolio_registry_entries', [
				stringField('workspaceId'),
				stringField('displayName'),
				stringField('coreStorageNamespace'),
				stringField('registeredAt'),
			]),
			addUniqueIndex('workspace_members', ['workspaceId', 'userId'], 'workspace_members_workspace_user_unique'),
			addUniqueIndex(
				'portfolio_registry_entries',
				['coreStorageNamespace'],
				'portfolio_registry_entries_core_storage_namespace_unique',
			),
		],
	},
] as const satisfies readonly ServerStorageMigration[]

function createTable(name: string, fields: ServerFieldSpec[]): ServerCreateTableChange {
	return { kind: 'createTable', name, pk: { name: 'id', type: 'string' }, fields }
}

function stringField(name: string): ServerFieldSpec {
	return { name, type: 'string' }
}

function nullableStringField(name: string): ServerFieldSpec {
	return { name, type: 'string', nullable: true }
}

function addUniqueIndex(table: string, on: readonly string[], name: string) {
	return { kind: 'addIndex' as const, table, on, unique: true, name }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server storage migrations', () => {
		it('creates every Server storage schema table across migrations', () => {
			const createdTables = serverStorageMigrations
				.flatMap((migration) => migration.changes)
				.filter((change) => change.kind === 'createTable')
				.map((change) => change.name)
				.sort()

			expect(createdTables).toEqual(serverStorageSchemas.map((schema) => schema.name).sort())
		})
	})
}
