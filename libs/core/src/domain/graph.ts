import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe } from './commons'

const planGraphNodeRefPipe = v.object({ type: v.eq('plan'), projectId: idPipe, id: idPipe })
const deliveryGraphNodeRefPipe = v.object({ type: v.eq('delivery'), projectId: idPipe, id: idPipe })
const sliceGraphNodeRefPipe = v.object({ type: v.eq('slice'), projectId: idPipe, deliveryId: idPipe, id: idPipe })
const memoryGraphNodeRefPipe = v.object({ type: v.eq('memory'), id: idPipe })
const memoryRevisionGraphNodeRefPipe = v.object({ type: v.eq('memory-revision'), memoryId: idPipe, id: idPipe })

export const graphNodeRefPipe = v.discriminate((value) => value.type, {
	plan: planGraphNodeRefPipe,
	delivery: deliveryGraphNodeRefPipe,
	slice: sliceGraphNodeRefPipe,
	memory: memoryGraphNodeRefPipe,
	'memory-revision': memoryRevisionGraphNodeRefPipe,
})
export type GraphNodeRef = PipeOutput<typeof graphNodeRefPipe>

const deliveryDependsOnDeliveryEndpointPipe = v
	.object({ type: v.eq('depends-on'), from: deliveryGraphNodeRefPipe, to: deliveryGraphNodeRefPipe })
	.pipe(v.custom((link) => link.from.id !== link.to.id, 'Expected dependency endpoints to be different nodes.'))
	.pipe(v.custom((link) => link.from.projectId === link.to.projectId, 'Expected Delivery dependency endpoints in the same Project.'))

const sliceDependsOnSliceEndpointPipe = v
	.object({ type: v.eq('depends-on'), from: sliceGraphNodeRefPipe, to: sliceGraphNodeRefPipe })
	.pipe(v.custom((link) => link.from.id !== link.to.id, 'Expected dependency endpoints to be different nodes.'))
	.pipe(
		v.custom(
			(link) => link.from.projectId === link.to.projectId && link.from.deliveryId === link.to.deliveryId,
			'Expected Slice dependency endpoints in the same Delivery.',
		),
	)

export const linkDefPipe = v.discriminate((value) => `${value.type}-${value.from.type}-${value.to.type}`, {
	'produced-plan-memory': v.object({ type: v.eq('produced'), from: planGraphNodeRefPipe, to: memoryGraphNodeRefPipe }),
	'produced-plan-memory-revision': v.object({
		type: v.eq('produced'),
		from: planGraphNodeRefPipe,
		to: memoryRevisionGraphNodeRefPipe,
	}),
	'depends-on-delivery-delivery': deliveryDependsOnDeliveryEndpointPipe,
	'depends-on-slice-slice': sliceDependsOnSliceEndpointPipe,
})
export type LinkDef = PipeOutput<typeof linkDefPipe>

export const linkPipe = v.object({ id: idPipe, def: linkDefPipe, created: auditStampPipe })
export type Link = PipeOutput<typeof linkPipe>

if (import.meta.vitest) {
	const { describe, expect, test } = import.meta.vitest

	describe('Link definition pipe', () => {
		test('accepts supported Link Definition variants', () => {
			expect(
				v.validate(
					linkPipe,
					link({
						type: 'produced',
						from: { type: 'plan', projectId: 'project-1', id: 'plan-1' },
						to: { type: 'memory', id: 'memory-1' },
					}),
				).valid,
			).toBe(true)
			expect(
				v.validate(
					linkPipe,
					link({
						type: 'produced',
						from: { type: 'plan', projectId: 'project-1', id: 'plan-1' },
						to: { type: 'memory-revision', memoryId: 'memory-1', id: 'revision-1' },
					}),
				).valid,
			).toBe(true)
			expect(
				v.validate(
					linkPipe,
					link({
						type: 'depends-on',
						from: { type: 'delivery', projectId: 'project-1', id: 'delivery-2' },
						to: { type: 'delivery', projectId: 'project-1', id: 'delivery-1' },
					}),
				).valid,
			).toBe(true)
			expect(
				v.validate(
					linkPipe,
					link({
						type: 'depends-on',
						from: { type: 'slice', projectId: 'project-1', deliveryId: 'delivery-1', id: 'slice-2' },
						to: { type: 'slice', projectId: 'project-1', deliveryId: 'delivery-1', id: 'slice-1' },
					}),
				).valid,
			).toBe(true)
		})

		test('rejects invalid dependency scopes and endpoint pairs', () => {
			expect(
				v.validate(linkDefPipe, {
					type: 'depends-on',
					from: { type: 'delivery', projectId: 'project-1', id: 'delivery-2' },
					to: { type: 'delivery', projectId: 'project-2', id: 'delivery-1' },
				}).valid,
			).toBe(false)
			expect(
				v.validate(linkDefPipe, {
					type: 'depends-on',
					from: { type: 'slice', projectId: 'project-1', deliveryId: 'delivery-1', id: 'slice-2' },
					to: { type: 'slice', projectId: 'project-1', deliveryId: 'delivery-2', id: 'slice-1' },
				}).valid,
			).toBe(false)
			expect(
				v.validate(linkDefPipe, {
					type: 'depends-on',
					from: { type: 'delivery', projectId: 'project-1', id: 'delivery-1' },
					to: { type: 'delivery', projectId: 'project-1', id: 'delivery-1' },
				}).valid,
			).toBe(false)
			expect(
				v.validate(linkDefPipe, {
					type: 'produced',
					from: { type: 'plan', projectId: 'project-1', id: 'plan-1' },
					to: { type: 'delivery', projectId: 'project-1', id: 'delivery-1' },
				}).valid,
			).toBe(false)
			expect(
				v.validate(linkDefPipe, {
					type: 'depends-on',
					from: { type: 'plan', projectId: 'project-1', id: 'plan-1' },
					to: { type: 'memory', id: 'memory-1' },
				}).valid,
			).toBe(false)
		})
	})

	function link(def: LinkDef): Link {
		return { id: 'link-1', def, created: { origin: 'imported', at: '2026-07-03T00:00:00.000Z' } }
	}
}
