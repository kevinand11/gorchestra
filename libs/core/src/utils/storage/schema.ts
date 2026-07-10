import { AsyncLocalStorage } from 'node:async_hooks'

import { Schema, type AnySchema, type AnySchemaField, type SchemaField, type SchemaFields } from 'equipped/orm'
import { v } from 'valleyed'

import { idPipe, type Id } from '../../domain/commons'

const explicitStorageId = new AsyncLocalStorage<Id>()

export function coreSchema<const Name extends string>(name: Name) {
	return Schema.from(name).pk('id', idPipe, explicitCoreIdRequired)
}

export function schemaToPipe<S extends AnySchema>(schema: S) {
	type Branches = {
		[K in keyof SchemaFields<S>]: SchemaFields<S>[K] extends SchemaField<string, infer P, boolean> ? P : never
	}

	const fields = Object.values(schema.fields as Record<string, AnySchemaField>)
	const branches = Object.fromEntries(fields.map((field) => [field.name, field.pipe])) as Branches
	return v.object(branches)
}

export function withExplicitCoreStorageId<T>(id: Id, run: () => Promise<T>): Promise<T> {
	return explicitStorageId.run(id, run)
}

function explicitCoreIdRequired(): Id {
	const id = explicitStorageId.getStore()
	if (id === undefined) throw new Error('Core must provide storage record ids explicitly.')

	return id
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { Repo } = await import('equipped/orm')
	const { InMemoryAdapter } = await import('equipped/orm/adapters/in-memory')

	describe('Core storage schema support', () => {
		it('derives persisted-field-only pipes from schemas', () => {
			const schema = coreSchema('examples')
				.field('title', v.string().pipe(v.asTrimmed()))
				.computed('display', ['title'], v.string(), ({ title }) => title.toUpperCase())
				.build()

			expect(
				v.validate(schemaToPipe(schema), {
					id: '01k00000000000000000000030',
					title: ' Example ',
					display: 'ignored',
				}),
			).toEqual({
				valid: true,
				value: { id: '01k00000000000000000000030', title: 'Example' },
			})
		})

		it('requires Core to provide storage ids explicitly', async () => {
			const schema = coreSchema('examples').field('title', v.string()).build()
			const storage = Repo.from(InMemoryAdapter.create({}))
				.resolve((resolvedSchema) => ({ table: resolvedSchema.name }))
				.build()

			await expect(storage.on(schema).one().create({ title: 'Example' })).rejects.toThrow(
				'Core must provide storage record ids explicitly.',
			)
		})
	})
}
