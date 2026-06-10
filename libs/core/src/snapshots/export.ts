import { v, type PipeOutput } from 'valleyed'

import { buildSnapshotStub } from './utils'
import { nonEmptyRawStringPipe } from '../domain/commons'
import type { PortfolioSnapshotManifest } from '../domain/snapshot'
import type { InvalidInputError, NotImplementedError } from '../errors'
import type { Result as CoreResult } from '../types'

const exportSnapshotInputPipe = v.object({ passphrase: nonEmptyRawStringPipe })
export type Input = PipeOutput<typeof exportSnapshotInputPipe>

export interface Result {
	manifest: PortfolioSnapshotManifest
	encryptedPayload: Uint8Array<ArrayBuffer>
}

export type Error = InvalidInputError | NotImplementedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createExportSnapshotOperation(): Operation {
	return buildSnapshotStub<Result, typeof exportSnapshotInputPipe>('export', exportSnapshotInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('export snapshot operation', () => {
		it('validates input before returning not implemented', async () => {
			const operation = createExportSnapshotOperation()

			const result = await operation({ passphrase: '' })

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'snapshot', operation: 'export' } })
		})
	})
}
