import { validateActiveSecret } from './command-storage'
import type { DeliveryContext, DeliveryDependencySummary } from './delivery-context-types'
import {
	preflightDeliveryWork,
	type DeliveryPreflight,
	type DeliveryPreflightError,
	type DeliveryPreflightSnapshot,
	type PassedDeliveryPreflight,
} from './delivery-preflight'
import { getRequired, listRecords, notFound } from './storage'
import type { Result } from './types'
import { actionPipe, type Action } from '../domain/action'
import { agentRunPipe, type AgentRun } from '../domain/agent-run'
import { deliveryArtifactPipe, sliceArtifactPipe, type DeliveryArtifact, type SliceArtifact } from '../domain/artifact'
import type { ArchivePeriod, Id } from '../domain/commons'
import { portfolioConfigRecordPipe, type DeliveryWorkConfig, type PortfolioConfigRecord, type ProjectConfigRecord } from '../domain/config'
import { deliveryPipe, type Delivery } from '../domain/delivery'
import type { ValidationEvidence } from '../domain/evidence'
import { linkPipe, type Link } from '../domain/graph'
import { modelPipe, type Model } from '../domain/model'
import { modelProviderPipe, type ModelProvider, type ModelProviderHeader } from '../domain/model-provider'
import { projectPipe, type Project } from '../domain/project'
import { repositoryPipe, type Repository } from '../domain/repository'
import { reviewSurfacePipe, type ReviewSurface } from '../domain/review-surface'
import { slicePipe, type Slice } from '../domain/slice'
import type {
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	SecretNotActiveError,
	StorageOperationFailedError,
} from '../errors'
import { resolvedSecretValuesPipe, type CoreServices, type CoreStorageTransaction, type ResolvedSecretValues } from '../services'
import { validateCoreServiceOutput } from '../validation'
import { latestAction } from './work-state/actions'
import type { DeliveryDependencyLink, SliceDependencyLink, WorkStateDerivationError } from './work-state/types'

export type { DeliveryContext, DeliveryDependencySummary } from './delivery-context-types'

export interface ModelProviderResolvedAccess {
	auth: { type: 'apiKey'; plaintext: string } | null
	headers: Array<{ name: string; plaintext: string }>
}

export type RuntimeDeliveryWorkContext = Omit<DeliveryContext, 'phase'> & {
	phase: 'runtime'
	workConfig: DeliveryWorkConfig
	executionModel: Model
	executionModelProvider: ModelProvider
	sourceControlAccessToken: { type: 'access-token'; plaintext: string }
	modelProviderAccess: ModelProviderResolvedAccess
}

export type RuntimeDeliveryWorkContextUpgrade =
	| { type: 'runtime-context'; context: RuntimeDeliveryWorkContext; snapshot: DeliveryPreflightSnapshot }
	| { type: 'failed-preflight'; checks: ValidationEvidence[]; snapshot: DeliveryPreflightSnapshot }

export type DeliveryContextError = WorkStateDerivationError
export type RuntimeDeliveryWorkContextError = DeliveryPreflightError

export async function buildDeliveryContext(
	tx: CoreStorageTransaction,
	deliveryId: Delivery['id'],
): Promise<Result<DeliveryContext, DeliveryContextError>> {
	const root = await readDeliveryContextRoot(tx, deliveryId)
	if (!root.ok) return root

	const records = await readDeliveryContextRecords(tx)
	if (!records.ok) return records

	return deliveryContext(root.value, scopedDeliveryContextRecords(root.value.delivery, records.value))
}

interface DeliveryContextRoot {
	delivery: Delivery
	project: Project
	repository: Repository
	portfolioConfig: PortfolioConfigRecord | null
	projectConfig: ProjectConfigRecord | null
}

interface DeliveryContextRecords {
	slices: Slice[]
	links: Link[]
	actions: Action[]
	agentRuns: AgentRun[]
	deliveries: Delivery[]
	deliveryArtifacts: DeliveryArtifact[]
	sliceArtifacts: SliceArtifact[]
	reviewSurfaces: ReviewSurface[]
}

interface ScopedDeliveryContextRecords {
	slices: Slice[]
	actions: Action[]
	agentRuns: AgentRun[]
	deliveryArtifacts: DeliveryArtifact[]
	sliceArtifacts: SliceArtifact[]
	reviewSurfaces: ReviewSurface[]
	deliveryDependencies: DeliveryDependencySummary[]
	sliceDependencyLinks: SliceDependencyLink[]
}

async function readDeliveryContextRoot(
	tx: CoreStorageTransaction,
	deliveryId: Delivery['id'],
): Promise<Result<DeliveryContextRoot, DeliveryContextError>> {
	const delivery = await getRequired('delivery', tx.deliveries, deliveryId, deliveryPipe)
	return delivery.ok ? readDeliveryContextRootForDelivery(tx, delivery.value) : delivery
}

async function readDeliveryContextRootForDelivery(
	tx: CoreStorageTransaction,
	delivery: Delivery,
): Promise<Result<DeliveryContextRoot, DeliveryContextError>> {
	const [project, repository, portfolioConfig] = await Promise.all([
		getRequired('project', tx.projects, delivery.projectId, projectPipe),
		getRequired('repository', tx.repositories, delivery.target.repositoryId, repositoryPipe),
		readOptionalPortfolioConfig(tx),
	])
	const failure = firstFailure([project, repository, portfolioConfig])
	if (failure !== null) return failure

	const projectRecord = resultValue(project)
	const repositoryRecord = resultValue(repository)
	const projectBoundary = repositoryProjectBoundary(projectRecord, repositoryRecord)
	return projectBoundary.ok
		? { ok: true, value: deliveryContextRoot(delivery, projectRecord, repositoryRecord, resultValue(portfolioConfig)) }
		: projectBoundary
}

function deliveryContextRoot(
	delivery: Delivery,
	project: Project,
	repository: Repository,
	portfolioConfig: PortfolioConfigRecord | null,
): DeliveryContextRoot {
	return { delivery, project, repository, portfolioConfig, projectConfig: project.config }
}

function repositoryProjectBoundary(project: Project, repository: Repository): Result<void, InvariantViolationError> {
	return repository.projectId === project.id
		? { ok: true, value: undefined }
		: {
				ok: false,
				error: { type: 'invariant-violation', message: `Repository ${repository.id} is outside Project ${project.id}.` },
			}
}

async function readOptionalPortfolioConfig(
	tx: CoreStorageTransaction,
): Promise<Result<PortfolioConfigRecord | null, StorageOperationFailedError | InvalidCoreServiceOutputError>> {
	try {
		const record = await tx.portfolioConfig.get()
		if (record === null) return { ok: true, value: null }

		return validateCoreServiceOutput(portfolioConfigRecordPipe, record, 'storage', 'get-singleton:portfolio-config')
	} catch {
		return {
			ok: false,
			error: { type: 'storage-operation-failed', operation: { type: 'get-singleton', resource: 'portfolio-config' } },
		}
	}
}

async function readDeliveryContextRecords(tx: CoreStorageTransaction): Promise<Result<DeliveryContextRecords, DeliveryContextError>> {
	const records = await readDeliveryContextRecordResults(tx)
	const failure = firstFailure(records)
	return failure ?? okDeliveryContextRecords(records)
}

function okDeliveryContextRecords(
	records: Awaited<ReturnType<typeof readDeliveryContextRecordResults>>,
): Result<DeliveryContextRecords, DeliveryContextError> {
	const [slices, links, actions, agentRuns, deliveries, deliveryArtifacts, sliceArtifacts, reviewSurfaces] = records
	return {
		ok: true,
		value: {
			slices: resultValue(slices),
			links: resultValue(links),
			actions: resultValue(actions),
			agentRuns: resultValue(agentRuns),
			deliveries: resultValue(deliveries),
			deliveryArtifacts: resultValue(deliveryArtifacts),
			sliceArtifacts: resultValue(sliceArtifacts),
			reviewSurfaces: resultValue(reviewSurfaces),
		},
	}
}

async function readDeliveryContextRecordResults(tx: CoreStorageTransaction) {
	return Promise.all([
		listRecords('slice', tx.slices, slicePipe),
		listRecords('link', tx.links, linkPipe),
		listRecords('action', tx.actions, actionPipe),
		listRecords('agent-run', tx.agentRuns, agentRunPipe),
		listRecords('delivery', tx.deliveries, deliveryPipe),
		listRecords('delivery-artifact', tx.deliveryArtifacts, deliveryArtifactPipe),
		listRecords('slice-artifact', tx.sliceArtifacts, sliceArtifactPipe),
		listRecords('review-surface', tx.reviewSurfaces, reviewSurfacePipe),
	] as const)
}

function scopedDeliveryContextRecords(
	delivery: Delivery,
	records: DeliveryContextRecords,
): Result<ScopedDeliveryContextRecords, DeliveryContextError> {
	const slices = deliverySlices(delivery, records.slices)
	const sliceIds = new Set(slices.map((slice) => slice.id))
	const dependencies = deliveryDependencies(delivery, records)
	if (!dependencies.ok) return dependencies

	return {
		ok: true,
		value: {
			slices,
			actions: records.actions.filter((action) => action.deliveryId === delivery.id),
			agentRuns: records.agentRuns.filter((run) => agentRunReferencesDelivery(run, delivery.id)),
			deliveryArtifacts: records.deliveryArtifacts.filter((artifact) => artifact.deliveryId === delivery.id),
			sliceArtifacts: records.sliceArtifacts.filter((artifact) => sliceIds.has(artifact.sliceId)),
			reviewSurfaces: records.reviewSurfaces.filter((reviewSurface) =>
				reviewSurfaceReferencesDelivery(reviewSurface, delivery.id, sliceIds),
			),
			deliveryDependencies: dependencies.value,
			sliceDependencyLinks: sliceDependencyLinks(sliceIds, records.links),
		},
	}
}

function deliverySlices(delivery: Delivery, slices: Slice[]): Slice[] {
	return slices
		.filter((slice) => slice.deliveryId === delivery.id)
		.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

function agentRunReferencesDelivery(run: AgentRun, deliveryId: Delivery['id']): boolean {
	return run.purpose.type === 'execution' && run.purpose.deliveryId === deliveryId
}

function reviewSurfaceReferencesDelivery(reviewSurface: ReviewSurface, deliveryId: Delivery['id'], sliceIds: Set<Id>): boolean {
	return reviewSurface.scope.type === 'delivery'
		? reviewSurface.scope.deliveryId === deliveryId
		: sliceIds.has(reviewSurface.scope.sliceId)
}

function sliceDependencyLinks(sliceIds: Set<Id>, links: Link[]): SliceDependencyLink[] {
	return links.filter((link): link is SliceDependencyLink => isContextSliceDependencyLink(link, sliceIds)).sort(compareDependencyLinks)
}

function isContextSliceDependencyLink(link: Link, sliceIds: Set<Id>): link is SliceDependencyLink {
	return isActiveDependsOnLink(link) && isSliceDependencyEndpointLink(link) && sliceIds.has(link.from.id)
}

function isSliceDependencyEndpointLink(link: Link): link is SliceDependencyLink {
	return link.from.type === 'slice' && link.to.type === 'slice'
}

function compareDependencyLinks(
	left: DeliveryDependencyLink | SliceDependencyLink,
	right: DeliveryDependencyLink | SliceDependencyLink,
): number {
	return left.created.at.localeCompare(right.created.at) || left.to.id.localeCompare(right.to.id)
}

function isArchived(archivePeriods: ArchivePeriod[]): boolean {
	return archivePeriods.at(-1)?.unarchived === null
}

function deliveryDependencies(
	delivery: Delivery,
	records: DeliveryContextRecords,
): Result<DeliveryDependencySummary[], DeliveryContextError> {
	const summaries: DeliveryDependencySummary[] = []
	for (const link of deliveryDependencyLinks(delivery, records.links)) {
		const summary = deliveryDependencySummary(delivery, link, records)
		if (!summary.ok) return summary
		summaries.push(summary.value)
	}

	return { ok: true, value: summaries }
}

function deliveryDependencyLinks(delivery: Delivery, links: Link[]): DeliveryDependencyLink[] {
	return links
		.filter((link): link is DeliveryDependencyLink => isContextDeliveryDependencyLink(link, delivery))
		.sort(compareDependencyLinks)
}

function isContextDeliveryDependencyLink(link: Link, delivery: Delivery): link is DeliveryDependencyLink {
	return isActiveDependsOnLink(link) && isDeliveryDependencyEndpointLink(link) && link.from.id === delivery.id
}

function isActiveDependsOnLink(link: Link): boolean {
	return link.type === 'depends-on' && !isArchived(link.archivePeriods)
}

function isDeliveryDependencyEndpointLink(link: Link): link is DeliveryDependencyLink {
	return link.from.type === 'delivery' && link.to.type === 'delivery'
}

function deliveryDependencySummary(
	delivery: Delivery,
	link: DeliveryDependencyLink,
	records: DeliveryContextRecords,
): Result<DeliveryDependencySummary, DeliveryContextError> {
	const dependency = records.deliveries.find((candidate) => candidate.id === link.to.id)
	if (dependency === undefined) return notFound('delivery', link.to.id)
	if (dependency.projectId !== delivery.projectId) {
		return {
			ok: false,
			error: {
				type: 'invariant-violation',
				message: `Delivery dependency ${dependency.id} is outside Project ${delivery.projectId}.`,
			},
		}
	}

	return { ok: true, value: { link, delivery: dependency, closedBy: latestDeliveryCloseAction(dependency, records.actions) } }
}

function latestDeliveryCloseAction(delivery: Delivery, actions: Action[]): Action | null {
	return latestAction(
		actions.filter(
			(action) =>
				action.deliveryId === delivery.id && (action.result.type === 'ship-delivery' || action.result.type === 'abandon-delivery'),
		),
	)
}

function firstFailure<TError>(results: ReadonlyArray<Result<unknown, TError>>): Result<never, TError> | null {
	const failure = results.find((result) => !result.ok)
	return failure === undefined || failure.ok ? null : failure
}

function resultValue<TValue>(result: Result<TValue, unknown>): TValue {
	if (!result.ok) throw new Error('Expected result value after checking for failures.')

	return result.value
}

export async function upgradeToRuntimeDeliveryWorkContext(
	services: CoreServices,
	tx: CoreStorageTransaction,
	stored: DeliveryContext,
): Promise<Result<RuntimeDeliveryWorkContextUpgrade, RuntimeDeliveryWorkContextError>> {
	const localPreflight = await preflightDeliveryWork(tx, stored.delivery)
	return localPreflight.ok ? runtimeContextUpgradeForPreflight(services, tx, stored, localPreflight.value) : localPreflight
}

async function runtimeContextUpgradeForPreflight(
	services: CoreServices,
	tx: CoreStorageTransaction,
	stored: DeliveryContext,
	preflight: DeliveryPreflight,
): Promise<Result<RuntimeDeliveryWorkContextUpgrade, RuntimeDeliveryWorkContextError>> {
	return preflight.type === 'failed'
		? failedRuntimeContextUpgrade(preflight.checks, preflight.snapshot)
		: runtimeContextUpgradeForPassedPreflight(services, tx, stored, preflight)
}

async function runtimeContextUpgradeForPassedPreflight(
	services: CoreServices,
	tx: CoreStorageTransaction,
	stored: DeliveryContext,
	preflight: PassedDeliveryPreflight,
): Promise<Result<RuntimeDeliveryWorkContextUpgrade, RuntimeDeliveryWorkContextError>> {
	const modelFacts = await runtimeModelFacts(tx, preflight.modelId)
	if (!modelFacts.ok) return modelFacts

	const access = await runtimeProviderAccess(services, tx, stored.repository.config.secretId, modelFacts.value.modelProvider)
	return access.ok ? runtimeContextUpgradeWithAccess(stored, preflight, modelFacts.value, access.value) : access
}

function runtimeContextUpgradeWithAccess(
	stored: DeliveryContext,
	preflight: PassedDeliveryPreflight,
	modelFacts: { model: Model; modelProvider: ModelProvider },
	access: RuntimeProviderAccess,
): Result<RuntimeDeliveryWorkContextUpgrade, never> {
	return access.type === 'failed-preflight'
		? { ok: true, value: access }
		: okRuntimeDeliveryWorkContext(stored, preflight, modelFacts, access)
}

function okRuntimeDeliveryWorkContext(
	stored: DeliveryContext,
	preflight: PassedDeliveryPreflight,
	modelFacts: { model: Model; modelProvider: ModelProvider },
	access: Extract<RuntimeProviderAccess, { type: 'resolved' }>,
): Result<RuntimeDeliveryWorkContextUpgrade, never> {
	return {
		ok: true,
		value: {
			type: 'runtime-context',
			context: runtimeDeliveryWorkContext(stored, preflight, modelFacts, access),
			snapshot: preflight.checks.map((check) => check.summary).join('|'),
		},
	}
}

function runtimeDeliveryWorkContext(
	stored: DeliveryContext,
	preflight: PassedDeliveryPreflight,
	modelFacts: { model: Model; modelProvider: ModelProvider },
	access: Extract<RuntimeProviderAccess, { type: 'resolved' }>,
): RuntimeDeliveryWorkContext {
	return {
		...stored,
		phase: 'runtime',
		workConfig: preflight.workConfig,
		executionModel: modelFacts.model,
		executionModelProvider: modelFacts.modelProvider,
		sourceControlAccessToken: { type: 'access-token', plaintext: access.repositoryAccessToken },
		modelProviderAccess: access.modelProviderAccess,
	}
}

function failedRuntimeContextUpgrade(
	checks: ValidationEvidence[],
	snapshot: DeliveryPreflightSnapshot,
): Result<Extract<RuntimeDeliveryWorkContextUpgrade, { type: 'failed-preflight' }>, never> {
	return { ok: true, value: { type: 'failed-preflight', checks, snapshot } }
}

async function runtimeModelFacts(
	tx: CoreStorageTransaction,
	modelId: Id,
): Promise<Result<{ model: Model; modelProvider: ModelProvider }, RuntimeDeliveryWorkContextError>> {
	const model = await getRequired('model', tx.models, modelId, modelPipe)
	if (!model.ok) return model

	const modelProvider = await getRequired('model-provider', tx.modelProviders, model.value.providerId, modelProviderPipe)
	return modelProvider.ok ? { ok: true, value: { model: model.value, modelProvider: modelProvider.value } } : modelProvider
}

type RuntimeProviderAccess =
	| { type: 'resolved'; repositoryAccessToken: string; modelProviderAccess: ModelProviderResolvedAccess }
	| Extract<RuntimeDeliveryWorkContextUpgrade, { type: 'failed-preflight' }>

async function runtimeProviderAccess(
	services: CoreServices,
	tx: CoreStorageTransaction,
	repositorySecretId: Id,
	modelProvider: ModelProvider,
): Promise<Result<RuntimeProviderAccess, RuntimeDeliveryWorkContextError>> {
	const secretIds = providerAccessSecretIds(repositorySecretId, modelProvider)
	const readiness = await runtimeProviderAccessReadiness(tx, secretIds)
	return readiness.ok
		? runtimeProviderAccessAfterReadiness(services, repositorySecretId, modelProvider, secretIds, readiness.value)
		: readiness
}

async function runtimeProviderAccessReadiness(
	tx: CoreStorageTransaction,
	secretIds: Id[],
): Promise<
	Result<ValidationEvidence[] | Extract<RuntimeDeliveryWorkContextUpgrade, { type: 'failed-preflight' }>, RuntimeDeliveryWorkContextError>
> {
	const readiness = await providerAccessSecretsReady(tx, secretIds)
	return readiness.ok && readiness.value.length > 0 ? failedRuntimeContextUpgrade(readiness.value, JSON.stringify(secretIds)) : readiness
}

async function runtimeProviderAccessAfterReadiness(
	services: CoreServices,
	repositorySecretId: Id,
	modelProvider: ModelProvider,
	secretIds: Id[],
	readiness: ValidationEvidence[] | Extract<RuntimeDeliveryWorkContextUpgrade, { type: 'failed-preflight' }>,
): Promise<Result<RuntimeProviderAccess, RuntimeDeliveryWorkContextError>> {
	return Array.isArray(readiness)
		? resolvedRuntimeProviderAccess(services, repositorySecretId, modelProvider, secretIds)
		: { ok: true, value: readiness }
}

async function resolvedRuntimeProviderAccess(
	services: CoreServices,
	repositorySecretId: Id,
	modelProvider: ModelProvider,
	secretIds: Id[],
): Promise<Result<RuntimeProviderAccess, RuntimeDeliveryWorkContextError>> {
	const plaintext = await resolveRuntimeSecretValues(services, secretIds)
	return plaintext.ok ? runtimeProviderAccessFromPlaintext(repositorySecretId, modelProvider, secretIds, plaintext.value) : plaintext
}

function runtimeProviderAccessFromPlaintext(
	repositorySecretId: Id,
	modelProvider: ModelProvider,
	secretIds: Id[],
	plaintext: ResolvedSecretValues,
): Result<RuntimeProviderAccess, never> {
	const unresolved = unresolvedProviderAccessChecks(repositorySecretId, modelProvider, plaintext)
	return unresolved.length > 0
		? failedRuntimeContextUpgrade(unresolved, JSON.stringify(secretIds))
		: {
				ok: true,
				value: {
					type: 'resolved',
					repositoryAccessToken: plaintext[repositorySecretId]!,
					modelProviderAccess: modelProviderAccess(modelProvider, plaintext),
				},
			}
}

function providerAccessSecretIds(repositorySecretId: Id, modelProvider: ModelProvider): Id[] {
	return [repositorySecretId, ...modelProviderSecretIds(modelProvider)]
}

function modelProviderSecretIds(modelProvider: ModelProvider): Id[] {
	return [modelProvider.auth?.secretId, ...modelProvider.headers.map((header) => header.valueSecretId)].filter(
		(id): id is Id => id !== undefined,
	)
}

async function providerAccessSecretsReady(
	tx: CoreStorageTransaction,
	secretIds: Id[],
): Promise<Result<ValidationEvidence[], RuntimeDeliveryWorkContextError>> {
	const checks: ValidationEvidence[] = []
	for (const secretId of secretIds) {
		const ready = await validateActiveSecret(tx, secretId)
		if (!ready.ok) {
			const check = secretReadinessCheck(secretId, ready.error)
			if (check === null) return secretReadinessOperationError(ready.error)
			checks.push(check)
		}
	}

	return { ok: true, value: checks }
}

function secretReadinessCheck(
	secretId: Id,
	error: ResourceNotFoundError | SecretNotActiveError | StorageOperationFailedError | InvalidCoreServiceOutputError,
): ValidationEvidence | null {
	if (error.type === 'not-found' && error.resource === 'secret')
		return validationEvidence('delivery-preflight', false, `Secret ${secretId} is missing.`)
	if (error.type === 'secret-not-active') return validationEvidence('delivery-preflight', false, `Secret ${secretId} is not active.`)

	return null
}

function secretReadinessOperationError(
	error: ResourceNotFoundError | SecretNotActiveError | StorageOperationFailedError | InvalidCoreServiceOutputError,
): Result<never, RuntimeDeliveryWorkContextError> {
	return error.type === 'storage-operation-failed' || error.type === 'invalid-core-service-output'
		? { ok: false, error }
		: { ok: false, error: { type: 'invariant-violation', message: 'Unexpected Secret readiness error.' } }
}

async function resolveRuntimeSecretValues(
	services: CoreServices,
	secretIds: Id[],
): Promise<Result<ResolvedSecretValues, RuntimeDeliveryWorkContextError>> {
	try {
		return validateCoreServiceOutput(
			resolvedSecretValuesPipe,
			await services.secrets.resolveSecretValues({ secretIds }),
			'secrets',
			'resolveSecretValues',
		)
	} catch {
		return { ok: true, value: {} }
	}
}

function unresolvedProviderAccessChecks(
	repositorySecretId: Id,
	modelProvider: ModelProvider,
	plaintext: ResolvedSecretValues,
): ValidationEvidence[] {
	return [
		...missingSecretValueCheck(repositorySecretId, 'Repository access Secret value could not be resolved.'),
		...modelProviderSecretIds(modelProvider).flatMap((secretId) =>
			missingSecretValueCheck(secretId, 'Model Provider Secret value could not be resolved.'),
		),
	]
		.filter((check) => plaintext[check.secretId] === undefined)
		.map((check) => check.evidence)
}

function missingSecretValueCheck(secretId: Id, summary: string): Array<{ secretId: Id; evidence: ValidationEvidence }> {
	return [{ secretId, evidence: validationEvidence('delivery-preflight', false, summary) }]
}

function modelProviderAccess(modelProvider: ModelProvider, plaintext: ResolvedSecretValues): ModelProviderResolvedAccess {
	return {
		auth: modelProvider.auth === null ? null : { type: 'apiKey', plaintext: plaintext[modelProvider.auth.secretId]! },
		headers: modelProvider.headers.map((header) => modelProviderHeaderAccess(header, plaintext)),
	}
}

function modelProviderHeaderAccess(header: ModelProviderHeader, plaintext: ResolvedSecretValues): { name: string; plaintext: string } {
	return { name: header.name, plaintext: plaintext[header.valueSecretId]! }
}

function validationEvidence(operation: ValidationEvidence['operation']['type'], passed: boolean, summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: operation }, passed, summary }
}

function deliveryContext(
	root: DeliveryContextRoot,
	records: Result<ScopedDeliveryContextRecords, DeliveryContextError>,
): Result<DeliveryContext, DeliveryContextError> {
	return records.ok ? { ok: true, value: { phase: 'stored', ...root, ...records.value } } : records
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { getDeliveryState, getSliceState } = await import('./work-state')
	const { createTestCoreServices, localStamp, seedDelivery, seedProject, seedSecret, seedSelectableModel, seedSlice } =
		await import('./test-helpers')

	describe('buildDeliveryContext', () => {
		it('loads root-level Delivery facts and supports derived unqueued state', async () => {
			const options = storedContextFixture()

			const result = await buildDeliveryContext(options.tx, 'delivery-1')

			expect(result).toMatchObject({ ok: true, value: { phase: 'stored' } })
			if (result.ok) {
				expect(result.value.delivery.id).toBe('delivery-1')
				expect(result.value.project.id).toBe('project-1')
				expect(result.value.repository.id).toBe('repository-1')
				expect(getDeliveryState(result.value)).toEqual({ ok: true, value: { type: 'unqueued' } })
			}
		})

		it('loads Slices in Delivery order and supports derived Slice Work States', async () => {
			const options = storedContextFixture()
			seedSlice(options.tx, 'slice-2', 'delivery-1')
			seedSlice(options.tx, 'slice-1', 'delivery-1')

			const result = await buildDeliveryContext(options.tx, 'delivery-1')

			expect(result).toMatchObject({ ok: true, value: { slices: [{ id: 'slice-2' }, { id: 'slice-1' }] } })
			if (result.ok) {
				expect(getSliceState(result.value, 'slice-2')).toEqual({ ok: true, value: { type: 'needs-artifact-creation' } })
				expect(getSliceState(result.value, 'slice-1')).toEqual({ ok: true, value: { type: 'needs-artifact-creation' } })
			}
		})

		it('returns an invariant violation when the target Repository is outside the Delivery Project', async () => {
			const options = storedContextFixture()
			options.tx.repositories.records.get('repository-1')!.projectId = 'other-project'

			const result = await buildDeliveryContext(options.tx, 'delivery-1')

			expect(result).toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Repository repository-1 is outside Project project-1.' },
			})
		})

		it('returns failed preflight checks when runtime context needs missing Portfolio Config', async () => {
			const options = storedContextFixture()
			const stored = await buildDeliveryContext(options.tx, 'delivery-1')
			if (!stored.ok) throw new Error('Expected stored context.')

			const result = await upgradeToRuntimeDeliveryWorkContext(options, options.tx, stored.value)

			expect(result).toMatchObject({
				ok: true,
				value: {
					type: 'failed-preflight',
					checks: [
						{
							type: 'validation',
							operation: { type: 'delivery-preflight' },
							passed: false,
							summary: 'Portfolio Config is not configured.',
						},
					],
				},
			})
		})

		it('resolves runtime Delivery Work Context provider access plaintext', async () => {
			const options = storedContextFixture()
			seedSelectableModel(options.tx, 'model-1')
			seedPortfolioConfig(options)
			options.secrets.resolveSecretValues = () => Promise.resolve({ 'secret-1': 'github-token' })
			const stored = await buildDeliveryContext(options.tx, 'delivery-1')
			if (!stored.ok) throw new Error('Expected stored context.')

			const result = await upgradeToRuntimeDeliveryWorkContext(options, options.tx, stored.value)

			expect(result).toMatchObject({
				ok: true,
				value: {
					type: 'runtime-context',
					context: {
						phase: 'runtime',
						workConfig: { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30000 },
						executionModel: { id: 'model-1' },
						sourceControlAccessToken: { type: 'access-token', plaintext: 'github-token' },
						modelProviderAccess: { auth: null, headers: [] },
					},
				},
			})
		})
	})

	function seedPortfolioConfig(options: ReturnType<typeof storedContextFixture>) {
		options.tx.portfolioConfig.record = {
			configured: localStamp(),
			value: {
				model: {
					defaultModelId: 'model-1',
					planningModelId: null,
					revisionPlanningModelId: null,
					executionModelId: null,
					revisionExecutionModelId: null,
				},
				work: { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30000 },
			},
		}
	}

	function storedContextFixture() {
		const options = createTestCoreServices()
		seedProject(options.tx, 'project-1')
		seedDelivery(options.tx, 'delivery-1')
		seedSecret(options.tx, 'secret-1')
		options.tx.repositories.records.set('repository-1', {
			id: 'repository-1',
			projectId: 'project-1',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
			created: localStamp(),
		})
		return options
	}
}
