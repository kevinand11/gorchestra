import { Migrator, Repo } from 'equipped/orm'

import { readServerEnv } from '../env'
import { ensureServerInstance } from '../instance'
import type { ServerStorageAdapter, ServerStorageAdapterFactory, ServerStorageBackend } from './adapter'
import { createDefaultServerStorageBackend } from './json-adapter'
import { serverStorageMigrations } from './migrations'

export type ServerStorageRepo = ReturnType<typeof createServerStorageRepo>

export type ServerStorage = {
	adapter: ServerStorageAdapter
	repo: ServerStorageRepo
	close: () => Promise<void>
}

export type OpenServerStorageInput = {
	dataDir?: string
	adapterFactory?: ServerStorageAdapterFactory
}

let activeServerStorage: ServerStorage | null = null
let activeServerStorageStartup: Promise<ServerStorage> | null = null

export async function startServerStorage(input: OpenServerStorageInput = {}): Promise<ServerStorage> {
	if (activeServerStorage) return activeServerStorage
	activeServerStorageStartup ??= openServerStorage(input)
		.then((storage) => {
			activeServerStorage = storage
			return storage
		})
		.catch((error: unknown) => {
			activeServerStorageStartup = null
			throw error
		})
	return activeServerStorageStartup
}

export function getServerStorage(): ServerStorage {
	if (!activeServerStorage) throw new Error('Server storage has not been started')
	return activeServerStorage
}

export async function stopServerStorage(): Promise<void> {
	const storage = activeServerStorage
	activeServerStorage = null
	activeServerStorageStartup = null
	await storage?.close()
}

export async function openServerStorage(input: OpenServerStorageInput = {}): Promise<ServerStorage> {
	ensureServerInstance()
	const dataDir = input.dataDir ?? readServerEnv().GORCHESTRA_DATA_DIR
	const backend = await (input.adapterFactory ?? createDefaultServerStorageBackend)({ dataDir })
	const repo = createServerStorageRepo(backend)
	await Migrator.from<ServerStorageAdapter>(repo, backend.adapter).migrations(serverStorageMigrations).build().up()

	return {
		adapter: backend.adapter,
		repo,
		close: async () => {
			await backend.adapter.disconnect?.()
		},
	}
}

function createServerStorageRepo(backend: ServerStorageBackend) {
	return Repo.from(backend.adapter).resolve(backend.resolve).build()
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { mkdtemp, rm } = await import('node:fs/promises')
	const { tmpdir } = await import('node:os')
	const { join } = await import('node:path')

	let tempDataDirs: string[] = []

	afterEach(async () => {
		await stopServerStorage()
		await Promise.all(tempDataDirs.map((path) => rm(path, { recursive: true, force: true })))
		tempDataDirs = []
	})

	async function createTempDataDir(): Promise<string> {
		const dataDir = await mkdtemp(join(tmpdir(), 'gorchestra-server-storage-'))
		tempDataDirs.push(dataDir)
		return dataDir
	}

	describe('Server storage repo', () => {
		it('opens migrated Server storage through the configured backend', async () => {
			const storage = await openServerStorage({ dataDir: await createTempDataDir() })

			expect(await storage.adapter.loadMigrations()).toEqual([
				expect.objectContaining({ id: '2026-06-19-0001-create-server-identity-storage' }),
			])

			await storage.close()
		})

		it('starts one active Server storage instance for application lifetime', async () => {
			const storage = await startServerStorage({ dataDir: await createTempDataDir() })
			const again = await startServerStorage({ dataDir: await createTempDataDir() })

			expect(again).toBe(storage)
			expect(getServerStorage()).toBe(storage)
		})
	})
}
