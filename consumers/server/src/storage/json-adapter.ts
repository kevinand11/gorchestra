import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { JsonAdapter } from 'equipped/orm/adapters/json'

import type { ServerStorageAdapterFactoryInput, ServerStorageBackend } from './adapter'

export async function createDefaultServerStorageBackend(
	input: ServerStorageAdapterFactoryInput,
): Promise<ServerStorageBackend<JsonAdapter>> {
	const filePath = getDefaultServerStorageFilePath(input.dataDir)
	await mkdir(dirname(filePath), { recursive: true })
	return {
		adapter: JsonAdapter.create({ filePath }),
		resolve: (schema) => ({ table: schema.name }),
	}
}

export function getDefaultServerStorageFilePath(dataDir: string): string {
	return join(dataDir, 'server', 'storage.json')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Default Server storage backend', () => {
		it('keeps the initial JSON storage path under the Server namespace', () => {
			expect(getDefaultServerStorageFilePath('/tmp/gorchestra')).toBe('/tmp/gorchestra/server/storage.json')
		})
	})
}
