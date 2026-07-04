import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { Cache } from 'equipped/cache'
import { JsonCache } from 'equipped/cache/adapters/json'

import { ensureServerInstance } from './instance'

export type ServerCache = {
	getJson: <T>(key: string) => Promise<T | null>
	setJson: (key: string, value: unknown, ttlSeconds: number) => Promise<void>
	deleteValue: (key: string) => Promise<void>
}

export type ServerCacheRuntime = ServerCache & {
	adapter: JsonCache
}

export type StartServerCacheInput = {
	dataDir: string
}

let activeServerCache: ServerCacheRuntime | null = null
let activeServerCacheStartup: Promise<ServerCacheRuntime> | null = null

export async function startServerCache(input: StartServerCacheInput): Promise<ServerCacheRuntime> {
	if (activeServerCache) return activeServerCache
	activeServerCacheStartup ??= openServerCache(input)
		.then((cache) => {
			activeServerCache = cache
			return cache
		})
		.catch((error: unknown) => {
			activeServerCacheStartup = null
			throw error
		})
	return activeServerCacheStartup
}

export async function openServerCache(input: StartServerCacheInput): Promise<ServerCacheRuntime> {
	ensureServerInstance()
	const filePath = getDefaultServerCacheFilePath(input.dataDir)
	await mkdir(dirname(filePath), { recursive: true })
	const adapter = JsonCache.create({ filePath })
	return { adapter, ...createServerCacheFromAdapter(adapter) }
}

export function stopServerCache(): void {
	resetStartedServerCache()
}

export function resetStartedServerCache(): void {
	activeServerCache = null
	activeServerCacheStartup = null
}

export function createServerCacheFromAdapter(adapter: Cache): ServerCache {
	return {
		async getJson<T>(key: string): Promise<T | null> {
			const raw = await adapter.get(key)
			return raw === null ? null : (JSON.parse(raw) as T)
		},
		async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
			await adapter.set(key, JSON.stringify(value), ttlSeconds)
		},
		async deleteValue(key: string): Promise<void> {
			await adapter.delete(key)
		},
	}
}

export function getDefaultServerCacheFilePath(dataDir: string): string {
	return join(dataDir, 'server', 'cache.json')
}

if (import.meta.vitest) {
	const { afterAll, describe, it, expect } = import.meta.vitest

	const tempDataDirs: string[] = []

	afterAll(async () => {
		stopServerCache()
		await Promise.all(tempDataDirs.map((path) => rm(path, { recursive: true, force: true })))
	})

	async function createTempDataDir(): Promise<string> {
		const dataDir = await mkdtemp(join(tmpdir(), 'gorchestra-server-cache-'))
		tempDataDirs.push(dataDir)
		return dataDir
	}

	describe('Server cache helpers', () => {
		it('keeps the default JSON cache path under the Server namespace', () => {
			expect(getDefaultServerCacheFilePath('/tmp/gorchestra')).toBe('/tmp/gorchestra/server/cache.json')
		})

		it('stores, reads, and deletes JSON values through the Server cache', async () => {
			const cache = await startServerCache({ dataDir: await createTempDataDir() })
			await ensureServerInstance().start()
			const key = `cache-test:${crypto.randomUUID()}`
			await cache.setJson(key, { value: 'cached' }, 60)
			await expect(cache.getJson<{ value: string }>(key)).resolves.toEqual({ value: 'cached' })

			await cache.deleteValue(key)
			await expect(cache.getJson(key)).resolves.toBeNull()
		})
	})
}
