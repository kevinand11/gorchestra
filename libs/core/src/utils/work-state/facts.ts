import { actionPipe } from '../../domain/action'
import { agentRunPipe } from '../../domain/agent-run'
import { deliveryArtifactPipe, sliceArtifactPipe } from '../../domain/artifact'
import { linkPipe } from '../../domain/graph'
import { reviewSurfacePipe } from '../../domain/review-surface'
import { slicePipe } from '../../domain/slice'
import type { CoreStorageTransaction } from '../../services'
import { listRecords, type StorageBoundaryError } from '../storage'
import type { Result } from '../types'
import { resultValue } from './shared'
import type { WorkStateFacts } from './types'

export async function loadWorkStateFacts(tx: CoreStorageTransaction): Promise<Result<WorkStateFacts, StorageBoundaryError>> {
	const actions = await listRecords('action', tx.actions, actionPipe)
	const agentRuns = await listRecords('agent-run', tx.agentRuns, agentRunPipe)
	const links = await listRecords('link', tx.links, linkPipe)
	const deliveryArtifacts = await listRecords('delivery-artifact', tx.deliveryArtifacts, deliveryArtifactPipe)
	const sliceArtifacts = await listRecords('slice-artifact', tx.sliceArtifacts, sliceArtifactPipe)
	const reviewSurfaces = await listRecords('review-surface', tx.reviewSurfaces, reviewSurfacePipe)
	const slices = await listRecords('slice', tx.slices, slicePipe)
	const failure = firstStorageFailure([actions, agentRuns, links, deliveryArtifacts, sliceArtifacts, reviewSurfaces, slices])
	if (failure !== null) return failure

	return {
		ok: true,
		value: {
			actions: resultValue(actions),
			agentRuns: resultValue(agentRuns),
			links: resultValue(links),
			deliveryArtifacts: resultValue(deliveryArtifacts),
			sliceArtifacts: resultValue(sliceArtifacts),
			reviewSurfaces: resultValue(reviewSurfaces),
			slices: resultValue(slices),
		},
	}
}

function firstStorageFailure(results: Array<Result<unknown[], StorageBoundaryError>>): Result<never, StorageBoundaryError> | null {
	const failure = results.find((result) => !result.ok)

	return failure === undefined || failure.ok ? null : { ok: false, error: failure.error }
}
