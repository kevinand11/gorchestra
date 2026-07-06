import { buildDeliveryContext } from '../../../utils/delivery-context'
import {
	createTestCoreServices,
	localStamp,
	seedAgentRunProfile,
	seedDelivery,
	seedSelectableModel,
	seedSlice,
	stamp,
} from '../../../utils/test-helpers'

export async function createDeliveryWorkHandlerTestContext(options: { sliceId?: string } = {}) {
	const services = createTestCoreServices()
	seedDelivery(services.tx, '01k00000000000000000000008')
	seedSelectableModel(services.tx, '01k00000000000000000000024')
	const executionProfile = seedAgentRunProfile(services.tx, '01k00000000000000000000006', '01k00000000000000000000024')
	if (options.sliceId !== undefined) seedSlice(services.tx, options.sliceId, '01k00000000000000000000008')

	services.tx.deliveries.records.get('01k00000000000000000000008')!.queued = localStamp()
	services.tx.deliveryArtifacts.records.set('01k00000000000000000000010', {
		id: '01k00000000000000000000010',
		deliveryId: '01k00000000000000000000008',
		config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
		created: stamp,
	})

	const deliveryContext = await buildDeliveryContext(services.tx, '01k00000000000000000000008')
	if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

	const workResolution = {
		workConfig: {
			maxProcessableSliceSlots: 1,
			maxCorrectionRetriesPerFailure: 1,
			executionAgentRunProfileId: executionProfile.id,
			revisionExecutionAgentRunProfileId: null,
		},
		executionProfile,
		executionModelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' as const },
		executionModel: services.tx.models.records.get('01k00000000000000000000024')!,
		executionModelProvider: services.tx.modelProviders.records.get('01k00000000000000000050024')!,
	}

	return {
		services,
		storage: services.tx,
		values: services.values,
		tx: services.tx,
		deliveryContext: deliveryContext.value,
		workResolution,
		repositoryAccessSecret: { secretId: '01k00000000000000000000040', valueRef: 'protected-ref' },
	}
}
