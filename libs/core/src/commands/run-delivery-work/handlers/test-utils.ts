import { buildDeliveryContext } from '../../../utils/delivery-context'
import { createTestCoreServices, localStamp, seedDelivery, seedSelectableModel, seedSlice, stamp } from '../../../utils/test-helpers'

export async function createRunDeliveryWorkHandlerTestContext(options: { sliceId?: string } = {}) {
	const services = createTestCoreServices()
	seedDelivery(services.tx, 'delivery-1')
	seedSelectableModel(services.tx, 'model-1')
	if (options.sliceId !== undefined) seedSlice(services.tx, options.sliceId, 'delivery-1')

	services.tx.deliveries.records.get('delivery-1')!.queued = localStamp()
	services.tx.deliveryArtifacts.records.set('delivery-artifact-1', {
		id: 'delivery-artifact-1',
		deliveryId: 'delivery-1',
		config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
		created: stamp,
	})

	const deliveryContext = await buildDeliveryContext(services.tx, 'delivery-1')
	if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

	const workResolution = {
		workConfig: { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
		executionModel: services.tx.models.records.get('model-1')!,
		executionModelProvider: services.tx.modelProviders.records.get('model-1-provider')!,
	}

	return {
		services,
		storage: services.tx,
		values: services.values,
		tx: services.tx,
		deliveryContext: deliveryContext.value,
		workResolution,
	}
}
