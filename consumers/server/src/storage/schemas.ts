import { randomUUID } from 'node:crypto'

import { Schema, type AnySchema, type SchemaOutput } from 'equipped/orm'
import { v } from 'valleyed'

const idPipe = v.string().pipe(v.min(1))
const isoDateTimePipe = v.string().pipe(v.min(1))
const nullableIsoDateTimePipe = v.nullable(isoDateTimePipe)
const emailPipe = v.string().pipe(v.email(), v.min(1))
const displayNamePipe = v.string().pipe(v.asTrimmed(), v.min(1))
const coreStorageNamespacePipe = v.string().pipe(v.asTrimmed(), v.min(1))

export const userSchema = Schema.from('users').pk('id', idPipe, randomUUID).field('createdAt', isoDateTimePipe).build()

export const emailAuthenticationIdentitySchema = Schema.from('email_authentication_identities')
	.pk('id', idPipe, randomUUID)
	.field('userId', idPipe)
	.field('email', emailPipe)
	.field('createdAt', isoDateTimePipe)
	.build()

export const workspaceSchema = Schema.from('workspaces')
	.pk('id', idPipe, randomUUID)
	.field('displayName', displayNamePipe)
	.field('createdAt', isoDateTimePipe)
	.build()

export const workspaceMemberSchema = Schema.from('workspace_members')
	.pk('id', idPipe, randomUUID)
	.field('workspaceId', idPipe)
	.field('userId', idPipe)
	.field('membershipStartedAt', isoDateTimePipe)
	.field('membershipEndedAt', nullableIsoDateTimePipe)
	.build()

export const workspaceOwnerRoleSchema = Schema.from('workspace_owner_roles')
	.pk('id', idPipe, randomUUID)
	.field('workspaceId', idPipe)
	.field('workspaceMemberId', idPipe)
	.field('assignedAt', isoDateTimePipe)
	.field('revokedAt', nullableIsoDateTimePipe)
	.build()

export const portfolioRegistryEntrySchema = Schema.from('portfolio_registry_entries')
	.pk('id', idPipe, randomUUID)
	.field('workspaceId', idPipe)
	.field('displayName', displayNamePipe)
	.field('coreStorageNamespace', coreStorageNamespacePipe)
	.field('registeredAt', isoDateTimePipe)
	.build()

export const serverStorageSchemas = [
	userSchema,
	emailAuthenticationIdentitySchema,
	workspaceSchema,
	workspaceMemberSchema,
	workspaceOwnerRoleSchema,
	portfolioRegistryEntrySchema,
] as const satisfies readonly AnySchema[]

export type ServerUser = SchemaOutput<typeof userSchema>
export type EmailAuthenticationIdentity = SchemaOutput<typeof emailAuthenticationIdentitySchema>
export type Workspace = SchemaOutput<typeof workspaceSchema>
export type WorkspaceMember = SchemaOutput<typeof workspaceMemberSchema>
export type WorkspaceOwnerRole = SchemaOutput<typeof workspaceOwnerRoleSchema>
export type PortfolioRegistryEntry = SchemaOutput<typeof portfolioRegistryEntrySchema>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server storage schemas', () => {
		it('defines the Server-owned storage tables', () => {
			expect(serverStorageSchemas.map((schema) => schema.name).sort()).toEqual([
				'email_authentication_identities',
				'portfolio_registry_entries',
				'users',
				'workspace_members',
				'workspace_owner_roles',
				'workspaces',
			])
		})
	})
}
