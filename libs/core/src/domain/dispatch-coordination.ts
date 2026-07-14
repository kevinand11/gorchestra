import { v, type PipeOutput } from 'valleyed'

import { idPipe, nonNegativeIntegerPipe, type Id } from './commons'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'

export const dispatchCoordinationId: Id = '00000000000000000000000000'

export const dispatchCoordinationSchema = coreSchema('dispatch_coordination')
	.field('epoch', nonNegativeIntegerPipe)
	.field('revision', nonNegativeIntegerPipe)
	.field('bootstrapVersion', nonNegativeIntegerPipe)
	.build()
export const dispatchCoordinationPipe = schemaToPipe(dispatchCoordinationSchema)
export type DispatchCoordination = PipeOutput<typeof dispatchCoordinationPipe>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Dispatch Coordination', () => {
		it('uses one fixed valid Core id', () => {
			expect(v.validate(idPipe, dispatchCoordinationId)).toEqual({ valid: true, value: dispatchCoordinationId })
		})

		it('rejects negative counters', () => {
			const record = { id: dispatchCoordinationId, epoch: 0, revision: 0, bootstrapVersion: 0 }
			expect(v.validate(dispatchCoordinationPipe, record).valid).toBe(true)
			expect(v.validate(dispatchCoordinationPipe, { ...record, epoch: -1 }).valid).toBe(false)
			expect(v.validate(dispatchCoordinationPipe, { ...record, revision: -1 }).valid).toBe(false)
			expect(v.validate(dispatchCoordinationPipe, { ...record, bootstrapVersion: -1 }).valid).toBe(false)
		})
	})
}
