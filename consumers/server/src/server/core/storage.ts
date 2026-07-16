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
import type { ServerConsumerCorePortfolioStorageConfig } from '../config'
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
	config: ServerConsumerCorePortfolioStorageConfig
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
		const opened = openCore(
			createCoreServices(coreStorage.storage, {
				secretEncryptionKey: input.secretEncryptionKey,
				sandboxRootDir: input.config.dataDir,
				coreStorageNamespace: input.coreStorageNamespace,
			}),
		)
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
	const storageDirectory = getCorePortfolioStorageDirectory(input.config, input.coreStorageNamespace)
	const backend = await corePortfolioStorageBackend(input.config, input.adapterFactory, storageDirectory)
	const storage = createCorePortfolioStorageRepo(backend)
	try {
		await backend.adapter.connect?.()
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
	await rm(getCorePortfolioStorageDirectory(input.config, input.coreStorageNamespace), { recursive: true, force: true })
}

export function getCorePortfolioStorageDirectory(config: ServerConsumerCorePortfolioStorageConfig, coreStorageNamespace: string): string {
	switch (config.type) {
		case 'json':
			return join(config.dataDir, 'core', parseCoreStorageNamespace(coreStorageNamespace))
		default:
			throw new Error(`Unexpected Core Portfolio storage config: ${JSON.stringify(config)}`)
	}
}

function corePortfolioStorageBackend(
	config: ServerConsumerCorePortfolioStorageConfig,
	adapterFactory: CorePortfolioStorageAdapterFactory | undefined,
	storageDirectory: string,
): CorePortfolioStorageBackend | Promise<CorePortfolioStorageBackend> {
	switch (config.type) {
		case 'json':
			return (adapterFactory ?? createDefaultCorePortfolioStorageBackend)({ storageDirectory })
		default:
			throw new Error(`Unexpected Core Portfolio storage config: ${JSON.stringify(config)}`)
	}
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
			const config = { type: 'json' as const, dataDir: '/tmp/gorchestra' }

			expect(namespace).toMatch(/^portfolios\/[0-9a-f-]+$/)
			expect(getCorePortfolioStorageDirectory(config, namespace)).toBe(`/tmp/gorchestra/core/${namespace}`)
			expect(() => getCorePortfolioStorageDirectory(config, '../escape')).toThrow('Core storage namespace is not valid')
		})

		it('runs Core migrations and verifies an empty Portfolio can open', async () => {
			const dataDir = await createTempDataDir()
			const config = { type: 'json' as const, dataDir }
			const coreStorageNamespace = createCoreStorageNamespace()

			const initialized = await initializeCorePortfolioStorage({ config, coreStorageNamespace, secretEncryptionKey })

			expect(initialized.coreStorageNamespace).toBe(coreStorageNamespace)
			expect(initialized.preflightReport).toEqual({
				passed: true,
				checks: { storage: { ok: true }, secrets: { ok: true } },
			})
			expect(existsSync(getDefaultCorePortfolioStorageFilePath(getCorePortfolioStorageDirectory(config, coreStorageNamespace)))).toBe(
				true,
			)

			const reopened = await openCorePortfolioStorage({ config, coreStorageNamespace })
			try {
				expect(await reopened.adapter.loadMigrations()).toEqual([
					expect.objectContaining({ id: '2026-06-16-0001-create-core-storage' }),
					expect.objectContaining({ id: '2026-07-13-0002-durable-dispatch' }),
				])
			} finally {
				await reopened.close()
			}
		})
	})
}
