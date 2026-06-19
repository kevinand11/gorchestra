import { InMemoryCache } from 'equipped/cache/adapters/in-memory'

import { ensureServerInstance } from './instance'

let serverCache: InMemoryCache | null = null

function getServerCache(): InMemoryCache {
	ensureServerInstance()
	serverCache ??= InMemoryCache.create({})
	return serverCache
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
	const raw = await getServerCache().get(key)
	return raw === null ? null : (JSON.parse(raw) as T)
}

export async function setCachedJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
	await getServerCache().set(key, JSON.stringify(value), ttlSeconds)
}

export async function deleteCachedValue(key: string): Promise<void> {
	await getServerCache().delete(key)
}

if (import.meta.vitest) {
	const { describe, it, expect } = import.meta.vitest

	describe('Server cache helpers', () => {
		it('stores, reads, and deletes JSON values through the Server cache', async () => {
			const key = `cache-test:${crypto.randomUUID()}`
			await setCachedJson(key, { value: 'cached' }, 60)
			await expect(getCachedJson<{ value: string }>(key)).resolves.toEqual({ value: 'cached' })

			await deleteCachedValue(key)
			await expect(getCachedJson(key)).resolves.toBeNull()
		})
	})
}
