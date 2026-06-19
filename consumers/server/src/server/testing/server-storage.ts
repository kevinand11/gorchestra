import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openServerStorage, stopServerStorage, type ServerStorage } from '../storage/repo'

export type TempServerStorageTestHarness = {
	createTempServerDataDir: () => Promise<string>
	withTempServerStorage: <T>(run: (serverStorage: ServerStorage) => Promise<T>) => Promise<T>
	cleanupTempServerStorage: () => Promise<void>
}

export function createTempServerStorageTestHarness(prefix: string): TempServerStorageTestHarness {
	let tempDataDirs: string[] = []

	async function createTempServerDataDir(): Promise<string> {
		const dataDir = await mkdtemp(join(tmpdir(), prefix))
		tempDataDirs.push(dataDir)
		return dataDir
	}

	async function withTempServerStorage<T>(run: (serverStorage: ServerStorage) => Promise<T>): Promise<T> {
		const serverStorage = await openServerStorage({ dataDir: await createTempServerDataDir() })
		try {
			return await run(serverStorage)
		} finally {
			await serverStorage.close()
		}
	}

	async function cleanupTempServerStorage(): Promise<void> {
		await stopServerStorage()
		await Promise.all(tempDataDirs.map((path) => rm(path, { recursive: true, force: true })))
		tempDataDirs = []
	}

	return { createTempServerDataDir, withTempServerStorage, cleanupTempServerStorage }
}
