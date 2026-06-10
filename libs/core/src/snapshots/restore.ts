import { v, type PipeOutput } from 'valleyed'

import { buildSnapshotStub } from './utils'
import { nonEmptyRawStringPipe } from '../domain/commons'
import type { PortfolioSnapshotManifest } from '../domain/snapshot'
import type { InvalidInputError, NotImplementedError } from '../errors'
import type { Result as CoreResult } from '../types'

const encryptedSnapshotPayloadPipe = v
	.instanceOf(Uint8Array, 'Expected a Uint8Array encrypted snapshot payload.')
	.pipe(v.custom<Uint8Array<ArrayBuffer>>((value) => value.byteLength > 0, 'Expected a non-empty encrypted snapshot payload.'))

const restoreSnapshotInputPipe = v.object({ passphrase: nonEmptyRawStringPipe, encryptedPayload: encryptedSnapshotPayloadPipe })
export type Input = PipeOutput<typeof restoreSnapshotInputPipe>

export interface Result {
	manifest: PortfolioSnapshotManifest
}

export type Error = InvalidInputError | NotImplementedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createRestoreSnapshotOperation(): Operation {
	return buildSnapshotStub<Result, typeof restoreSnapshotInputPipe>('restore', restoreSnapshotInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('restore snapshot operation', () => {
		it('validates input before returning not implemented', async () => {
			const operation = createRestoreSnapshotOperation()

			const result = await operation({ passphrase: 'passphrase', encryptedPayload: new Uint8Array() })

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'snapshot', operation: 'restore' } })
		})

		it('accepts unknown input fields before returning not implemented', async () => {
			const operation = createRestoreSnapshotOperation()

			const result = await operation({
				passphrase: 'passphrase',
				encryptedPayload: new Uint8Array([1]),
				unknown: 'stripped',
			} as never)

			expect(result).toEqual({ ok: false, error: { type: 'not-implemented', operation: 'restore' } })
		})
	})
}
