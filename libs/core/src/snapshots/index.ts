import { createExportSnapshotOperation } from './export'
import { createRestoreSnapshotOperation } from './restore'

export type * as Export from './export'
export type * as Restore from './restore'

export function createCoreSnapshots() {
	return {
		export: createExportSnapshotOperation(),
		restore: createRestoreSnapshotOperation(),
	}
}

export type Core = ReturnType<typeof createCoreSnapshots>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Core snapshots', () => {
		it('exposes export and restore operations', () => {
			const snapshots = createCoreSnapshots()

			expect(typeof snapshots.export).toBe('function')
			expect(typeof snapshots.restore).toBe('function')
		})
	})
}
