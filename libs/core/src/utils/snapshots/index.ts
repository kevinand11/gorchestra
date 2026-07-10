import { createExportSnapshotOperation } from './export'
import { createRestoreSnapshotOperation } from './restore'
import type { CoreRuntime } from '../runtime'

export type * as Export from './export'
export type * as Restore from './restore'

export function createCoreSnapshots(_runtime: CoreRuntime) {
	return {
		export: createExportSnapshotOperation(),
		restore: createRestoreSnapshotOperation(),
	}
}

export type Core = ReturnType<typeof createCoreSnapshots>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createCoreRuntime } = await import('../runtime')
	const { createTestCoreServices } = await import('../test-helpers')

	describe('Core snapshots', () => {
		it('exposes export and restore operations', () => {
			const snapshots = createCoreSnapshots(createCoreRuntime(createTestCoreServices()))

			expect(typeof snapshots.export).toBe('function')
			expect(typeof snapshots.restore).toBe('function')
		})
	})
}
