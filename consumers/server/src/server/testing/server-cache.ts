import { InMemoryCache } from 'equipped/cache/adapters/in-memory'

import { createServerCacheFromAdapter, type ServerCache } from '../cache'
import { ensureServerInstance } from '../instance'

export function createTestServerCache(): ServerCache {
	ensureServerInstance()
	return createServerCacheFromAdapter(InMemoryCache.create({}))
}
