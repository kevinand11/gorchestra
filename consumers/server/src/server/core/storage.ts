import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import {
	coreStorageMigrations,
	openCore,
	type CorePreflightReport,
	type CoreStorage,
	type CoreStorageAdapter as GorchestraCoreStorageAdapter,
} from '@gorchestra/core'
import { Migrator, Repo, type AnySchema, type OrmAdapter, type OrmAdapterConfig, type RepoSurface } from 'equipped/orm'
import { v } from 'valleyed'

import { createDefaultCorePortfolioStorageBackend } from './json-adapter'
import { createCoreServices } from './services'
import type { SecretEncryptionKey } from '../modules/secret-protection'

export type CorePortfolioStorageAdapter = GorchestraCoreStorageAdapter &
	OrmAdapter &
	Required<
		Pick<
			OrmAdapter,
			| 'loadMigrations'
			| 'recordMigration'
			| 'applyCreateTable'
			| 'applyAddIndex'
			| 'applyAddField'
			| 'applyDropField'
			| 'applyModifyField'
			| 'applyRenameField'
			| 'applyDropTable'
			| 'applyRenameTable'
		>
	>

export type CorePortfolioStorageBackend<A extends CorePortfolioStorageAdapter = CorePortfolioStorageAdapter> = {
	adapter: A
	resolve: (schema: AnySchema) => OrmAdapterConfig<A>
}

export type CorePortfolioStorageAdapterFactoryInput = {
	storageDirectory: string
}

export type CorePortfolioStorageAdapterFactory<A extends CorePortfolioStorageAdapter = CorePortfolioStorageAdapter> = (
	input: CorePortfolioStorageAdapterFactoryInput,
) => CorePortfolioStorageBackend<A> | Promise<CorePortfolioStorageBackend<A>>

export type OpenCorePortfolioStorageInput = {
	dataDir: string
	coreStorageNamespace: string
	adapterFactory?: CorePortfolioStorageAdapterFactory
}

export type CorePortfolioStorage = {
	adapter: CorePortfolioStorageAdapter
	storage: CoreStorage
	close: () => Promise<void>
}

export type InitializeCorePortfolioStorageInput = OpenCorePortfolioStorageInput & {
	secretEncryptionKey: SecretEncryptionKey
}

export type InitializeCorePortfolioStorageResult = {
	coreStorageNamespace: string
	preflightReport: CorePreflightReport
}

const coreStorageNamespacePipe = v
	.string()
	.pipe(v.asTrimmed(), v.min(1), v.custom(isSafeCoreStorageNamespace, 'Core storage namespace must be a safe relative path.'))

export function createCoreStorageNamespace(): string {
	return `portfolios/${randomUUID()}`
}

export async function initializeCorePortfolioStorage(
	input: InitializeCorePortfolioStorageInput,
): Promise<InitializeCorePortfolioStorageResult> {
	const coreStorage = await openCorePortfolioStorage(input)
	try {
		const opened = openCore(createCoreServices(coreStorage.storage, { secretEncryptionKey: input.secretEncryptionKey }))
		if (!opened.ok) throw new Error(`Core failed to open: ${opened.error.type}`)

		const preflight = await opened.value.preflight()
		if (!preflight.ok) throw new Error(`Core preflight failed: ${preflight.error.type}`)
		if (!preflight.value.passed) throw new Error('Core preflight did not pass')

		return { coreStorageNamespace: input.coreStorageNamespace, preflightReport: preflight.value }
	} finally {
		await coreStorage.close()
	}
}

export async function openCorePortfolioStorage(input: OpenCorePortfolioStorageInput): Promise<CorePortfolioStorage> {
	const storageDirectory = getCorePortfolioStorageDirectory(input.dataDir, input.coreStorageNamespace)
	const backend = await (input.adapterFactory ?? createDefaultCorePortfolioStorageBackend)({ storageDirectory })
	const storage = createCorePortfolioStorageRepo(backend)
	try {
		await Migrator.from(storage, backend.adapter).migrations(coreStorageMigrations).build().up()
		return {
			adapter: backend.adapter,
			storage,
			close: async () => {
				await backend.adapter.disconnect?.()
			},
		}
	} catch (error) {
		await backend.adapter.disconnect?.().catch(() => {})
		throw error
	}
}

export async function removeCorePortfolioStorage(input: OpenCorePortfolioStorageInput): Promise<void> {
	await rm(getCorePortfolioStorageDirectory(input.dataDir, input.coreStorageNamespace), { recursive: true, force: true })
}

export function getCorePortfolioStorageDirectory(dataDir: string, coreStorageNamespace: string): string {
	return join(dataDir, 'core', parseCoreStorageNamespace(coreStorageNamespace))
}

function createCorePortfolioStorageRepo<A extends CorePortfolioStorageAdapter>(backend: CorePortfolioStorageBackend<A>): RepoSurface<A> {
	return Repo.from(backend.adapter).resolve(backend.resolve).build()
}

function parseCoreStorageNamespace(coreStorageNamespace: string): string {
	const result = v.validate(coreStorageNamespacePipe, coreStorageNamespace)
	if (!result.valid) throw new Error(`Core storage namespace is not valid\n${result.error.toString()}`)
	return result.value
}

function isSafeCoreStorageNamespace(coreStorageNamespace: string): boolean {
	if (coreStorageNamespace.startsWith('/') || coreStorageNamespace.includes('\\')) return false
	const segments = coreStorageNamespace.split('/')
	return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { existsSync } = await import('node:fs')
	const { mkdtemp, rm } = await import('node:fs/promises')
	const { tmpdir } = await import('node:os')
	const { join } = await import('node:path')
	const { getDefaultCorePortfolioStorageFilePath } = await import('./json-adapter')

	let tempDataDirs: string[] = []

	afterEach(async () => {
		await Promise.all(tempDataDirs.map((path) => rm(path, { recursive: true, force: true })))
		tempDataDirs = []
	})

	async function createTempDataDir(): Promise<string> {
		const dataDir = await mkdtemp(join(tmpdir(), 'gorchestra-server-core-storage-'))
		tempDataDirs.push(dataDir)
		return dataDir
	}

	const secretEncryptionKey = Buffer.alloc(32, 1)

	describe('Server Core storage', () => {
		it('creates safe per-Portfolio Core storage namespaces', () => {
			const namespace = createCoreStorageNamespace()

			expect(namespace).toMatch(/^portfolios\/[0-9a-f-]+$/)
			expect(getCorePortfolioStorageDirectory('/tmp/gorchestra', namespace)).toBe(`/tmp/gorchestra/core/${namespace}`)
			expect(() => getCorePortfolioStorageDirectory('/tmp/gorchestra', '../escape')).toThrow('Core storage namespace is not valid')
		})

		it('runs Core migrations and verifies an empty Portfolio can open', async () => {
			const dataDir = await createTempDataDir()
			const coreStorageNamespace = createCoreStorageNamespace()

			const initialized = await initializeCorePortfolioStorage({ dataDir, coreStorageNamespace, secretEncryptionKey })

			expect(initialized.coreStorageNamespace).toBe(coreStorageNamespace)
			expect(initialized.preflightReport.passed).toBe(true)
			expect(
				existsSync(getDefaultCorePortfolioStorageFilePath(getCorePortfolioStorageDirectory(dataDir, coreStorageNamespace))),
			).toBe(true)

			const reopened = await openCorePortfolioStorage({ dataDir, coreStorageNamespace })
			try {
				expect(await reopened.adapter.loadMigrations()).toEqual([
					expect.objectContaining({ id: '2026-06-16-0001-create-core-storage' }),
				])
			} finally {
				await reopened.close()
			}
		})
	})
}
