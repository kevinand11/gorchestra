import type { AnySchema, SchemaPersistedOutput } from 'equipped/orm'

import { actionSchema } from '../../domain/action'
import { agentRunSchema } from '../../domain/agent-run'
import { agentRunEventSchema } from '../../domain/agent-run-event'
import { agentRunProfileSchema } from '../../domain/agent-run-profile'
import { deliverySchema } from '../../domain/delivery'
import { deliveryArtifactSchema } from '../../domain/delivery-artifact'
import { linkSchema } from '../../domain/link'
import { memorySchema } from '../../domain/memory'
import { memoryRevisionSchema } from '../../domain/memory-revision'
import { modelSchema } from '../../domain/model'
import { modelProviderSchema } from '../../domain/model-provider'
import { planSchema } from '../../domain/plan'
import { projectSchema } from '../../domain/project'
import { repositorySchema } from '../../domain/repository'
import { reviewSurfaceSchema } from '../../domain/review-surface'
import { revisionSchema } from '../../domain/revision'
import { revisionGateSchema } from '../../domain/revision-gate'
import { secretSchema } from '../../domain/secret'
import { sliceSchema } from '../../domain/slice'
import { sliceArtifactSchema } from '../../domain/slice-artifact'

export const coreIdResourceSchemas = {
	project: projectSchema,
	repository: repositorySchema,
	'model-provider': modelProviderSchema,
	model: modelSchema,
	'agent-run-profile': agentRunProfileSchema,
	plan: planSchema,
	delivery: deliverySchema,
	slice: sliceSchema,
	link: linkSchema,
	memory: memorySchema,
	'memory-revision': memoryRevisionSchema,
	'delivery-artifact': deliveryArtifactSchema,
	'slice-artifact': sliceArtifactSchema,
	action: actionSchema,
	'agent-run': agentRunSchema,
	'agent-run-event': agentRunEventSchema,
	'review-surface': reviewSurfaceSchema,
	'revision-gate': revisionGateSchema,
	revision: revisionSchema,
	secret: secretSchema,
} as const satisfies Record<string, AnySchema>

export type CoreIdResource = keyof typeof coreIdResourceSchemas
export type CoreResource = CoreIdResource

export const coreResourceSchemas = coreIdResourceSchemas
export const coreStorageSchemas = Object.values(coreIdResourceSchemas)

export type CoreIdStorageRecordMap = {
	[Resource in CoreIdResource]: SchemaPersistedOutput<(typeof coreIdResourceSchemas)[Resource]>
}
export type CoreStorageRecordMap = CoreIdStorageRecordMap
export type CoreStorageRecord<Resource extends CoreResource> = CoreStorageRecordMap[Resource]
export type CoreIdStorageRecord<Resource extends CoreIdResource> = CoreIdStorageRecordMap[Resource]
