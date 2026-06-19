import { randomUUID } from 'node:crypto'

import { Schema, type AnySchema, type SchemaOutput } from 'equipped/orm'
import { v } from 'valleyed'

const idPipe = v.string().pipe(v.min(1))
const isoDateTimePipe = v.string().pipe(v.min(1))
const emailPipe = v.string().pipe(v.email(), v.min(1))

export const userSchema = Schema.from('users').pk('id', idPipe, randomUUID).field('createdAt', isoDateTimePipe).build()

export const emailAuthenticationIdentitySchema = Schema.from('email_authentication_identities')
	.pk('id', idPipe, randomUUID)
	.field('userId', idPipe)
	.field('email', emailPipe)
	.field('createdAt', isoDateTimePipe)
	.build()

export const serverStorageSchemas = [userSchema, emailAuthenticationIdentitySchema] as const satisfies readonly AnySchema[]

export type ServerUser = SchemaOutput<typeof userSchema>
export type EmailAuthenticationIdentity = SchemaOutput<typeof emailAuthenticationIdentitySchema>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server storage schemas', () => {
		it('defines the Server-owned identity storage tables', () => {
			expect(serverStorageSchemas.map((schema) => schema.name).sort()).toEqual(['email_authentication_identities', 'users'])
		})
	})
}
