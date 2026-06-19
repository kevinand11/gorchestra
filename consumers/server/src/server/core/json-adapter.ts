import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { JsonAdapter } from 'equipped/orm/adapters/json'

import type { CorePortfolioStorageAdapterFactoryInput, CorePortfolioStorageBackend } from './storage'

export async function createDefaultCorePortfolioStorageBackend(
	input: CorePortfolioStorageAdapterFactoryInput,
): Promise<CorePortfolioStorageBackend<JsonAdapter>> {
	await mkdir(input.storageDirectory, { recursive: true })
	return {
		adapter: JsonAdapter.create({ filePath: getDefaultCorePortfolioStorageFilePath(input.storageDirectory) }),
		resolve: (schema) => ({ table: schema.name }),
	}
}

export function getDefaultCorePortfolioStorageFilePath(storageDirectory: string): string {
	return join(storageDirectory, 'storage.json')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Default Core Portfolio storage backend', () => {
		it('keeps the initial JSON storage file under the Portfolio storage directory', () => {
			expect(getDefaultCorePortfolioStorageFilePath('/tmp/gorchestra/core/portfolios/p1')).toBe(
				'/tmp/gorchestra/core/portfolios/p1/storage.json',
			)
		})
	})
}
