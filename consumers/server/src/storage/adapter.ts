import type { AnySchema, OrmAdapter, OrmAdapterConfig, OrmAdapterLike } from 'equipped/orm'

export type ServerStorageAdapter = OrmAdapter &
	OrmAdapterLike<unknown> &
	Required<
		Pick<
			OrmAdapter,
			'findByPk' | 'createMany' | 'findMany' | 'session' | 'loadMigrations' | 'recordMigration' | 'applyCreateTable' | 'applyAddIndex'
		>
	>

export type ServerStorageConfigResolver<A extends ServerStorageAdapter = ServerStorageAdapter> = (schema: AnySchema) => OrmAdapterConfig<A>

export type ServerStorageBackend<A extends ServerStorageAdapter = ServerStorageAdapter> = {
	adapter: A
	resolve: ServerStorageConfigResolver<A>
}

export type ServerStorageAdapterFactoryInput = {
	dataDir: string
}

export type ServerStorageAdapterFactory = (input: ServerStorageAdapterFactoryInput) => ServerStorageBackend | Promise<ServerStorageBackend>
