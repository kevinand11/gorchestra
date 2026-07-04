import { AsyncLocalStorage } from 'node:async_hooks'

import { Schema, type AnySchema } from 'equipped/orm'
import { v } from 'valleyed'

import { actionResultPipe, type Action } from '../domain/action'
import {
	agentPipe,
	agentRunEventBodyPipe,
	agentRunEventCursorPipe,
	agentRunModelUseOverridePipe,
	agentRunProfileSnapshotPipe,
	agentRunPurposePipe,
	type AgentRun,
	type AgentRunEvent,
} from '../domain/agent-run'
import { type AgentRunProfile } from '../domain/agent-run-profile'
import { deliveryArtifactConfigPipe, sliceArtifactConfigPipe, type DeliveryArtifact, type SliceArtifact } from '../domain/artifact'
import {
	archivePeriodPipe,
	auditStampPipe,
	idPipe,
	nonEmptyTrimmedStringPipe,
	nonNegativeIntegerPipe,
	runtimeRecordPipe,
	type Id,
} from '../domain/commons'
import { deliveryConfigRecordPipe, modelUseConfigPipe, projectConfigRecordPipe } from '../domain/config'
import { deliveryClosedPipe, deliveryTargetPipe, type Delivery } from '../domain/delivery'
import { linkDefPipe, type Link } from '../domain/graph'
import { currentMemoryRevisionPipe, memoryBodyPipe, memoryTitlePipe, type Memory, type MemoryRevision } from '../domain/memory'
import { modelCapabilitiesPipe, modelTokenPricingPipe, type Model } from '../domain/model'
import { modelProviderAuthPipe, modelProviderHeaderPipe, modelProviderProtocolPipe, type ModelProvider } from '../domain/model-provider'
import { instructionSourcePipe, type Plan } from '../domain/plan'
import { projectSourcePipe, type Project } from '../domain/project'
import { repositoryConfigPipe, type Repository } from '../domain/repository'
import { reviewSurfaceClosedPipe, reviewSurfaceConfigPipe, reviewSurfaceScopePipe, type ReviewSurface } from '../domain/review-surface'
import { revisionDispositionPipe, revisionGateClosedPipe, revisionScopePipe, type Revision, type RevisionGate } from '../domain/revision'
import { envNamePipe, secretBindingScopePipe, secretValueRefPipe, type Secret, type SecretBinding } from '../domain/secret'
import { type Slice } from '../domain/slice'
import type { CoreIdResource, CoreResource } from '../errors'

const explicitStorageId = new AsyncLocalStorage<Id>()
const archivePeriodsPipe = v.array(archivePeriodPipe)

export function withExplicitCoreStorageId<T>(id: Id, run: () => Promise<T>): Promise<T> {
	return explicitStorageId.run(id, run)
}

export const projectSchema = Schema.from('projects')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('title', nonEmptyTrimmedStringPipe)
	.field('source', projectSourcePipe)
	.field('config', projectConfigRecordPipe)
	.field('created', auditStampPipe)
	.build()

export const repositorySchema = Schema.from('repositories')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('projectId', idPipe)
	.field('config', repositoryConfigPipe)
	.field('created', auditStampPipe)
	.build()

export const modelProviderSchema = Schema.from('model_providers')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('name', nonEmptyTrimmedStringPipe)
	.field('protocol', modelProviderProtocolPipe)
	.field('baseUrl', nonEmptyTrimmedStringPipe)
	.field('auth', v.nullable(modelProviderAuthPipe))
	.field('headers', v.array(modelProviderHeaderPipe))
	.field('created', auditStampPipe)
	.field('updated', v.nullable(auditStampPipe))
	.field('archivePeriods', archivePeriodsPipe)
	.build()

export const modelSchema = Schema.from('models')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('providerId', idPipe)
	.field('name', nonEmptyTrimmedStringPipe)
	.field('providerModelId', nonEmptyTrimmedStringPipe)
	.field('capabilities', modelCapabilitiesPipe)
	.field('pricing', v.nullable(modelTokenPricingPipe))
	.field('created', auditStampPipe)
	.field('updated', v.nullable(auditStampPipe))
	.field('archivePeriods', archivePeriodsPipe)
	.build()

export const agentRunProfileSchema = Schema.from('agent_run_profiles')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('name', nonEmptyTrimmedStringPipe)
	.field('modelUse', modelUseConfigPipe)
	.field('created', auditStampPipe)
	.field('updated', v.nullable(auditStampPipe))
	.field('archivePeriods', archivePeriodsPipe)
	.build()

export const planSchema = Schema.from('plans')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('projectId', idPipe)
	.field('title', nonEmptyTrimmedStringPipe)
	.field('created', auditStampPipe)
	.field('closed', v.nullable(auditStampPipe))
	.build()

export const deliverySchema = Schema.from('deliveries')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('projectId', idPipe)
	.field('planId', idPipe)
	.field('title', nonEmptyTrimmedStringPipe)
	.field('target', deliveryTargetPipe)
	.field('config', v.nullable(deliveryConfigRecordPipe))
	.field('accepted', auditStampPipe)
	.field('queued', v.nullable(auditStampPipe))
	.field('closed', v.nullable(deliveryClosedPipe))
	.build()

export const sliceSchema = Schema.from('slices')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('deliveryId', idPipe)
	.field('order', nonNegativeIntegerPipe)
	.field('title', nonEmptyTrimmedStringPipe)
	.field('instruction', instructionSourcePipe)
	.field('accepted', auditStampPipe)
	.build()

export const linkSchema = Schema.from('links')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('def', linkDefPipe)
	.field('created', auditStampPipe)
	.build()

export const memorySchema = Schema.from('memories')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('parentId', v.nullable(idPipe))
	.field('currentRevision', currentMemoryRevisionPipe)
	.field('created', auditStampPipe)
	.build()

export const memoryRevisionSchema = Schema.from('memory_revisions')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('memoryId', idPipe)
	.field('title', memoryTitlePipe)
	.field('body', memoryBodyPipe)
	.field('created', auditStampPipe)
	.build()

export const deliveryArtifactSchema = Schema.from('delivery_artifacts')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('deliveryId', idPipe)
	.field('config', deliveryArtifactConfigPipe)
	.field('created', runtimeRecordPipe)
	.build()

export const sliceArtifactSchema = Schema.from('slice_artifacts')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('sliceId', idPipe)
	.field('config', sliceArtifactConfigPipe)
	.field('created', runtimeRecordPipe)
	.build()

export const actionSchema = Schema.from('actions')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('deliveryId', idPipe)
	.field('performed', runtimeRecordPipe)
	.field('authorized', v.nullable(auditStampPipe))
	.field('result', actionResultPipe)
	.build()

export const agentRunSchema = Schema.from('agent_runs')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('agent', agentPipe)
	.field('purpose', agentRunPurposePipe)
	.field('profile', agentRunProfileSnapshotPipe)
	.field('modelUseOverride', v.nullable(agentRunModelUseOverridePipe))
	.field('started', runtimeRecordPipe)
	.field('completed', v.nullable(runtimeRecordPipe))
	.build()

export const agentRunEventSchema = Schema.from('agent_run_events')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('agentRunId', idPipe)
	.field('cursor', agentRunEventCursorPipe)
	.field('occurred', runtimeRecordPipe)
	.field('body', agentRunEventBodyPipe)
	.build()

export const reviewSurfaceSchema = Schema.from('review_surfaces')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('scope', reviewSurfaceScopePipe)
	.field('config', reviewSurfaceConfigPipe)
	.field('title', nonEmptyTrimmedStringPipe)
	.field('closed', v.nullable(reviewSurfaceClosedPipe))
	.field('created', runtimeRecordPipe)
	.build()

export const revisionGateSchema = Schema.from('revision_gates')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('scope', revisionScopePipe)
	.field('reviewSurfaceId', idPipe)
	.field('opened', auditStampPipe)
	.field('closed', v.nullable(revisionGateClosedPipe))
	.build()

export const revisionSchema = Schema.from('revisions')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('revisionGateId', idPipe)
	.field('scope', revisionScopePipe)
	.field('instruction', instructionSourcePipe)
	.field('disposition', revisionDispositionPipe)
	.field('accepted', auditStampPipe)
	.build()

export const secretSchema = Schema.from('secrets')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('name', nonEmptyTrimmedStringPipe)
	.field('valueRef', secretValueRefPipe)
	.field('created', auditStampPipe)
	.field('replaced', v.nullable(auditStampPipe))
	.field('archivePeriods', archivePeriodsPipe)
	.build()

export const secretBindingSchema = Schema.from('secret_bindings')
	.pk('id', idPipe, explicitCoreIdRequired)
	.field('secretId', idPipe)
	.field('scope', secretBindingScopePipe)
	.field('envName', envNamePipe)
	.field('created', auditStampPipe)
	.field('archivePeriods', archivePeriodsPipe)
	.build()

export const coreStorageSchemas = [
	projectSchema,
	repositorySchema,
	modelProviderSchema,
	modelSchema,
	agentRunProfileSchema,
	planSchema,
	deliverySchema,
	sliceSchema,
	linkSchema,
	memorySchema,
	memoryRevisionSchema,
	deliveryArtifactSchema,
	sliceArtifactSchema,
	actionSchema,
	agentRunSchema,
	agentRunEventSchema,
	reviewSurfaceSchema,
	revisionGateSchema,
	revisionSchema,
	secretSchema,
	secretBindingSchema,
] as const satisfies readonly AnySchema[]

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
	'secret-binding': secretBindingSchema,
} as const satisfies Record<CoreIdResource, AnySchema>

export const coreResourceSchemas = coreIdResourceSchemas as Record<CoreResource, AnySchema>

export interface CoreIdStorageRecordMap {
	project: Project
	repository: Repository
	'model-provider': ModelProvider
	model: Model
	'agent-run-profile': AgentRunProfile
	plan: Plan
	delivery: Delivery
	slice: Slice
	link: Link
	memory: Memory
	'memory-revision': MemoryRevision
	'delivery-artifact': DeliveryArtifact
	'slice-artifact': SliceArtifact
	action: Action
	'agent-run': AgentRun
	'agent-run-event': AgentRunEvent
	'review-surface': ReviewSurface
	'revision-gate': RevisionGate
	revision: Revision
	secret: Secret
	'secret-binding': SecretBinding
}

export type CoreStorageRecordMap = CoreIdStorageRecordMap

export type CoreStorageRecord<Resource extends CoreResource> = CoreStorageRecordMap[Resource]
export type CoreIdStorageRecord<Resource extends CoreIdResource> = CoreIdStorageRecordMap[Resource]

function explicitCoreIdRequired(): Id {
	const id = explicitStorageId.getStore()
	if (id === undefined) throw new Error('Core must provide storage record ids explicitly.')

	return id
}
