import { v, type Pipe } from 'valleyed'

import {
	createPlanInputPipe,
	createProjectInputPipe,
	createRepositoryInputPipe,
	operationContextPipe,
	setPortfolioConfigInputPipe,
	setProjectConfigInputPipe,
	updateRepositoryConfigInputPipe,
	type CreatePlanInput,
	type CreateProjectInput,
	type CreateRepositoryInput,
	type OperationContext,
	type SetPortfolioConfigInput,
	type SetProjectConfigInput,
	type UpdateRepositoryConfigInput,
} from './boundary-pipes'
import type {
	ConfigCommandReferenceError,
	ConfigCommandStorageError,
	CoreCommands,
	CreatePlanError,
	CreateProjectError,
	CreateRepositoryError,
	SetPortfolioConfigError,
	SetProjectConfigError,
	UpdateRepositoryConfigError,
} from './commands'
import type {
	CoreResource,
	CoreStorageOperation,
	DuplicateRepositoryTargetError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ModelNotSelectableError,
	ProjectSourceTypeMismatchError,
	ResourceNotFoundError,
	SecretNotActiveError,
	StorageOperationFailedError,
} from './errors'
import type {
	ArchivePeriod,
	AuditStamp,
	IsoDateTime,
	Model,
	ModelId,
	ModelProvider,
	Plan,
	PlanConfig,
	PlanConfigRecord,
	PlanId,
	PortfolioConfig,
	PortfolioConfigRecord,
	Project,
	ProjectConfig,
	ProjectConfigRecord,
	ProjectId,
	Repository,
	RepositoryConfig,
	RepositoryId,
	Secret,
	SecretId,
} from './model'
import type { Result } from './result'
import {
	coreClockOutputPipe,
	coreIdOutputPipe,
	type CoreStorageTransaction,
	type OpenCoreOptions,
	type RepositoryTable,
	type SingletonRepository,
} from './services'
import { validateCoreInput, validateCoreServiceOutput } from './validation'

type ImplementedCommandName =
	| 'setPortfolioConfig'
	| 'createProject'
	| 'setProjectConfig'
	| 'createRepository'
	| 'updateRepositoryConfig'
	| 'createPlan'

type ImplementedCommands = Pick<CoreCommands, ImplementedCommandName>

type StorageBackedCommandError =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| ModelNotSelectableError
	| SecretNotActiveError
	| DuplicateRepositoryTargetError
	| ProjectSourceTypeMismatchError

type StorageResult<T> = Result<T, StorageOperationFailedError>

type CommandBoundary<TInput> = {
	input: TInput
	context: OperationContext
}

const implementedCommandPipes = {
	setPortfolioConfig: setPortfolioConfigInputPipe,
	createProject: createProjectInputPipe,
	setProjectConfig: setProjectConfigInputPipe,
	createRepository: createRepositoryInputPipe,
	updateRepositoryConfig: updateRepositoryConfigInputPipe,
	createPlan: createPlanInputPipe,
} satisfies Record<ImplementedCommandName, Pipe<unknown, unknown>>

export function createStorageBackedCommands(options: OpenCoreOptions): ImplementedCommands {
	return {
		setPortfolioConfig(input, context) {
			return runCommand('setPortfolioConfig', input, context, (validated) => setPortfolioConfig(options, validated))
		},
		createProject(input, context) {
			return runCommand('createProject', input, context, (validated) => createProject(options, validated))
		},
		setProjectConfig(input, context) {
			return runCommand('setProjectConfig', input, context, (validated) => setProjectConfig(options, validated))
		},
		createRepository(input, context) {
			return runCommand('createRepository', input, context, (validated) => createRepository(options, validated))
		},
		updateRepositoryConfig(input, context) {
			return runCommand('updateRepositoryConfig', input, context, (validated) => updateRepositoryConfig(options, validated))
		},
		createPlan(input, context) {
			return runCommand('createPlan', input, context, (validated) => createPlan(options, validated))
		},
	}
}

async function runCommand<TInput, TValue, TError extends StorageBackedCommandError>(
	operation: ImplementedCommandName,
	input: TInput,
	context: OperationContext,
	run: (boundary: CommandBoundary<TInput>) => Promise<Result<TValue, TError>>,
): Promise<Result<TValue, TError | InvalidInputError>> {
	const validation = validateCoreInput(
		v.object({ input: implementedCommandPipes[operation], context: operationContextPipe }),
		{ input, context },
		'command',
		operation,
	)

	if (!validation.ok) {
		return validation
	}

	return run(validation.value as CommandBoundary<TInput>)
}

async function setPortfolioConfig(
	options: OpenCoreOptions,
	boundary: CommandBoundary<SetPortfolioConfigInput>,
): Promise<Result<PortfolioConfigRecord, SetPortfolioConfigError>> {
	const stampResult = auditStamp(options, boundary.context)
	if (!stampResult.ok) return stampResult

	return withTransaction(options, async (tx) => {
		const config = normalizePortfolioConfig(boundary.input.config)
		const referenceValidation = await validateSelectableModels(tx, modelIdsFromPortfolioConfig(config))
		if (!referenceValidation.ok) return referenceValidation

		const record: PortfolioConfigRecord = { configured: stampResult.value, value: config }
		const putResult = await putSingleton(tx, 'portfolio-config', tx.portfolioConfig, record)
		if (!putResult.ok) return putResult

		return { ok: true, value: record }
	})
}

async function createProject(
	options: OpenCoreOptions,
	boundary: CommandBoundary<CreateProjectInput>,
): Promise<Result<Project, CreateProjectError>> {
	const stampResult = auditStamp(options, boundary.context)
	if (!stampResult.ok) return stampResult

	const idResult = nextId<ProjectId>(options, 'project')
	if (!idResult.ok) return idResult

	return withTransaction(options, async (tx) => {
		const config = normalizeProjectConfigRecordForCreate(boundary.input.config, stampResult.value)
		if (config !== null) {
			const referenceValidation = await validateSelectableModels(tx, modelIdsFromProjectConfigRecord(config))
			if (!referenceValidation.ok) return referenceValidation
		}

		const project: Project = {
			id: idResult.value,
			title: boundary.input.title,
			source: boundary.input.source as Project['source'],
			config,
			created: stampResult.value,
		}
		const putResult = await putRecord(tx, 'project', tx.projects, project.id, project)
		if (!putResult.ok) return putResult

		return { ok: true, value: project }
	})
}

async function setProjectConfig(
	options: OpenCoreOptions,
	boundary: CommandBoundary<SetProjectConfigInput>,
): Promise<Result<Project, SetProjectConfigError>> {
	const stampResult = auditStamp(options, boundary.context)
	if (!stampResult.ok) return stampResult

	return withTransaction(options, async (tx) => {
		const projectResult = await getRequired(tx, 'project', tx.projects, boundary.input.projectId)
		if (!projectResult.ok) return projectResult

		const config = normalizeProjectConfigRecord(boundary.input.config, stampResult.value)
		const referenceValidation = await validateSelectableModels(tx, modelIdsFromProjectConfigRecord(config))
		if (!referenceValidation.ok) return referenceValidation

		const project: Project = { ...projectResult.value, config }
		const putResult = await putRecord(tx, 'project', tx.projects, project.id, project)
		if (!putResult.ok) return putResult

		return { ok: true, value: project }
	})
}

async function createRepository(
	options: OpenCoreOptions,
	boundary: CommandBoundary<CreateRepositoryInput>,
): Promise<Result<Repository, CreateRepositoryError>> {
	const stampResult = auditStamp(options, boundary.context)
	if (!stampResult.ok) return stampResult

	const idResult = nextId<RepositoryId>(options, 'repository')
	if (!idResult.ok) return idResult

	return withTransaction(
		options,
		async (tx): Promise<Result<Repository, Exclude<CreateRepositoryError, InvalidInputError | InvalidCoreServiceOutputError>>> => {
			const projectValidation = await validateSourceControlProject(tx, boundary.input.projectId)
			if (!projectValidation.ok) return projectValidation

			const config = boundary.input.config as RepositoryConfig
			const secretValidation = await validateActiveSecret(tx, config.secretId)
			if (!secretValidation.ok) return secretValidation

			const duplicateValidation = await validateUniqueRepositoryTarget(tx, boundary.input.projectId, config, null)
			if (!duplicateValidation.ok) return duplicateValidation

			const repository: Repository = {
				id: idResult.value,
				projectId: boundary.input.projectId,
				config: normalizeRepositoryConfig(config),
				created: stampResult.value,
			}
			const putResult = await putRecord(tx, 'repository', tx.repositories, repository.id, repository)
			if (!putResult.ok) return putResult

			return { ok: true, value: repository }
		},
	)
}

async function updateRepositoryConfig(
	options: OpenCoreOptions,
	boundary: CommandBoundary<UpdateRepositoryConfigInput>,
): Promise<Result<Repository, UpdateRepositoryConfigError>> {
	return withTransaction(options, async (tx): Promise<Result<Repository, Exclude<UpdateRepositoryConfigError, InvalidInputError>>> => {
		const repositoryResult = await getRequired(tx, 'repository', tx.repositories, boundary.input.repositoryId)
		if (!repositoryResult.ok) return repositoryResult

		const projectValidation = await validateSourceControlProject(tx, repositoryResult.value.projectId)
		if (!projectValidation.ok) return projectValidation

		const config = boundary.input.config as RepositoryConfig
		const secretValidation = await validateActiveSecret(tx, config.secretId)
		if (!secretValidation.ok) return secretValidation

		const duplicateValidation = await validateUniqueRepositoryTarget(
			tx,
			repositoryResult.value.projectId,
			config,
			repositoryResult.value.id,
		)
		if (!duplicateValidation.ok) return duplicateValidation

		const repository: Repository = { ...repositoryResult.value, config: normalizeRepositoryConfig(config) }
		const putResult = await putRecord(tx, 'repository', tx.repositories, repository.id, repository)
		if (!putResult.ok) return putResult

		return { ok: true, value: repository }
	})
}

async function createPlan(options: OpenCoreOptions, boundary: CommandBoundary<CreatePlanInput>): Promise<Result<Plan, CreatePlanError>> {
	const stampResult = auditStamp(options, boundary.context)
	if (!stampResult.ok) return stampResult

	const idResult = nextId<PlanId>(options, 'plan')
	if (!idResult.ok) return idResult

	return withTransaction(options, async (tx) => {
		const projectResult = await getRequired(tx, 'project', tx.projects, boundary.input.projectId)
		if (!projectResult.ok) return projectResult

		const config = normalizePlanConfigRecord(boundary.input.config, stampResult.value)
		if (config !== null) {
			const referenceValidation = await validateSelectableModels(tx, modelIdsFromPlanConfigRecord(config))
			if (!referenceValidation.ok) return referenceValidation
		}

		const plan: Plan = {
			id: idResult.value,
			projectId: projectResult.value.id,
			title: boundary.input.title,
			config,
			created: stampResult.value,
		}
		const putResult = await putRecord(tx, 'plan', tx.plans, plan.id, plan)
		if (!putResult.ok) return putResult

		return { ok: true, value: plan }
	})
}

async function withTransaction<TValue, TError extends StorageBackedCommandError>(
	options: OpenCoreOptions,
	run: (tx: CoreStorageTransaction) => Promise<Result<TValue, TError>>,
): Promise<Result<TValue, TError | StorageOperationFailedError>> {
	try {
		return await options.storage.transaction(run)
	} catch {
		return { ok: false, error: storageFailure({ type: 'transaction' }) }
	}
}

async function putSingleton<TRecord>(
	_tx: CoreStorageTransaction,
	resource: 'portfolio-config',
	repository: SingletonRepository<TRecord>,
	record: TRecord,
): Promise<StorageResult<void>> {
	try {
		await repository.put(record)
		return { ok: true, value: undefined }
	} catch {
		return { ok: false, error: storageFailure({ type: 'put', resource, id: null }) }
	}
}

async function getRecord<TRecord, TId extends string>(
	resource: CoreResource,
	repository: RepositoryTable<TRecord, TId>,
	id: TId,
): Promise<StorageResult<TRecord | null>> {
	try {
		return { ok: true, value: await repository.get(id) }
	} catch {
		return { ok: false, error: storageFailure({ type: 'get', resource, id }) }
	}
}

async function getRequired<TRecord, TId extends string>(
	_tx: CoreStorageTransaction,
	resource: CoreResource,
	repository: RepositoryTable<TRecord, TId>,
	id: TId,
): Promise<Result<TRecord, StorageOperationFailedError | ResourceNotFoundError>> {
	const recordResult = await getRecord(resource, repository, id)
	if (!recordResult.ok) return recordResult
	if (recordResult.value === null) return { ok: false, error: { type: 'not-found', resource, id } }

	return { ok: true, value: recordResult.value }
}

async function putRecord<TRecord, TId extends string>(
	_tx: CoreStorageTransaction,
	resource: CoreResource,
	repository: RepositoryTable<TRecord, TId>,
	id: TId,
	record: TRecord,
): Promise<StorageResult<void>> {
	try {
		await repository.put(record)
		return { ok: true, value: undefined }
	} catch {
		return { ok: false, error: storageFailure({ type: 'put', resource, id }) }
	}
}

async function listRecords<TRecord>(
	resource: CoreResource,
	repository: RepositoryTable<TRecord, string>,
): Promise<StorageResult<TRecord[]>> {
	try {
		return { ok: true, value: await repository.list() }
	} catch {
		return { ok: false, error: storageFailure({ type: 'list', resource }) }
	}
}

async function validateSelectableModels(
	tx: CoreStorageTransaction,
	modelIds: ModelId[],
): Promise<Result<void, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	for (const modelId of uniqueIds(modelIds)) {
		const modelResult = await getRequired(tx, 'model', tx.models, modelId)
		if (!modelResult.ok) return modelResult

		const modelSelectability = validateActiveModel(modelResult.value)
		if (!modelSelectability.ok) return modelSelectability

		const providerResult = await getRequired(tx, 'model-provider', tx.modelProviders, modelResult.value.providerId)
		if (!providerResult.ok) return providerResult

		const providerSelectability = validateActiveModelProvider(modelId, providerResult.value)
		if (!providerSelectability.ok) return providerSelectability
	}

	return { ok: true, value: undefined }
}

function validateActiveModel(model: Model): Result<void, ModelNotSelectableError> {
	if (isArchived(model.archivePeriods)) {
		return { ok: false, error: { type: 'model-not-selectable', modelId: model.id, reason: 'model-archived' } }
	}

	return { ok: true, value: undefined }
}

function validateActiveModelProvider(modelId: ModelId, provider: ModelProvider): Result<void, ModelNotSelectableError> {
	if (isArchived(provider.archivePeriods)) {
		return { ok: false, error: { type: 'model-not-selectable', modelId, reason: 'provider-archived' } }
	}

	return { ok: true, value: undefined }
}

async function validateSourceControlProject(
	tx: CoreStorageTransaction,
	projectId: ProjectId,
): Promise<Result<Project, StorageOperationFailedError | ResourceNotFoundError | ProjectSourceTypeMismatchError>> {
	const projectResult = await getRequired(tx, 'project', tx.projects, projectId)
	if (!projectResult.ok) return projectResult
	if (projectResult.value.source.type !== 'source-control') {
		return {
			ok: false,
			error: {
				type: 'project-source-type-mismatch',
				projectId,
				expected: 'source-control',
				actual: projectResult.value.source.type,
			},
		}
	}

	return projectResult
}

async function validateActiveSecret(
	tx: CoreStorageTransaction,
	secretId: SecretId,
): Promise<Result<Secret, StorageOperationFailedError | ResourceNotFoundError | SecretNotActiveError>> {
	const secretResult = await getRequired(tx, 'secret', tx.secrets, secretId)
	if (!secretResult.ok) return secretResult
	if (isArchived(secretResult.value.archivePeriods)) {
		return { ok: false, error: { type: 'secret-not-active', secretId } }
	}

	return secretResult
}

async function validateUniqueRepositoryTarget(
	tx: CoreStorageTransaction,
	projectId: ProjectId,
	config: RepositoryConfig,
	excludeRepositoryId: RepositoryId | null,
): Promise<Result<void, StorageOperationFailedError | DuplicateRepositoryTargetError>> {
	const repositoriesResult = await listRecords('repository', tx.repositories)
	if (!repositoriesResult.ok) return repositoriesResult

	const target = repositoryTargetKey(config)
	const duplicate = repositoriesResult.value.find(
		(repository) =>
			repository.projectId === projectId &&
			repository.id !== excludeRepositoryId &&
			repositoryTargetKey(repository.config) === target,
	)

	if (duplicate !== undefined) {
		return {
			ok: false,
			error: {
				type: 'duplicate-repository-target',
				projectId,
				provider: config.provider,
				owner: config.owner,
				name: config.name,
			},
		}
	}

	return { ok: true, value: undefined }
}

function normalizePortfolioConfig(config: PortfolioConfig): PortfolioConfig {
	return {
		model: { ...config.model },
		work: config.work === null ? null : { ...config.work },
	}
}

function normalizeProjectConfigRecordForCreate(config: ProjectConfig | null, configured: AuditStamp): ProjectConfigRecord | null {
	if (config === null) {
		return null
	}

	const normalized = normalizeProjectConfig(config)
	return normalized === null ? null : { configured, value: normalized }
}

function normalizeProjectConfigRecord(config: ProjectConfig | null, configured: AuditStamp): ProjectConfigRecord | null {
	if (config === null) {
		return null
	}

	return { configured, value: normalizeProjectConfig(config) }
}

function normalizeProjectConfig(config: ProjectConfig): ProjectConfig | null {
	const model = normalizeProjectModelConfig(config.model)
	const work = config.work === null ? null : { ...config.work }

	if (model === null && work === null) {
		return null
	}

	return { model, work }
}

function normalizeProjectModelConfig(model: ProjectConfig['model']): ProjectConfig['model'] {
	if (model === null) {
		return null
	}

	if (
		model.planningModelId === null &&
		model.revisionPlanningModelId === null &&
		model.executionModelId === null &&
		model.revisionExecutionModelId === null
	) {
		return null
	}

	return { ...model }
}

function normalizePlanConfigRecord(config: PlanConfig | null, configured: AuditStamp): PlanConfigRecord | null {
	if (config === null) {
		return null
	}

	const normalized = normalizePlanConfig(config)
	return normalized === null ? null : { configured, value: normalized }
}

function normalizePlanConfig(config: PlanConfig): PlanConfig | null {
	if (config.model === null || config.model.planningModelId === null) {
		return null
	}

	return { model: { ...config.model } }
}

function normalizeRepositoryConfig(config: RepositoryConfig): RepositoryConfig {
	return { ...config }
}

function modelIdsFromPortfolioConfig(config: PortfolioConfig): ModelId[] {
	return [
		config.model.defaultModelId,
		config.model.planningModelId,
		config.model.revisionPlanningModelId,
		config.model.executionModelId,
		config.model.revisionExecutionModelId,
	].filter((modelId): modelId is ModelId => modelId !== null)
}

function modelIdsFromProjectConfigRecord(config: ProjectConfigRecord | null): ModelId[] {
	if (config?.value?.model === null || config?.value === null || config === null) {
		return []
	}

	return [
		config.value.model.planningModelId,
		config.value.model.revisionPlanningModelId,
		config.value.model.executionModelId,
		config.value.model.revisionExecutionModelId,
	].filter((modelId): modelId is ModelId => modelId !== null)
}

function modelIdsFromPlanConfigRecord(config: PlanConfigRecord): ModelId[] {
	if (config.value === null || config.value.model === null || config.value.model.planningModelId === null) {
		return []
	}

	return [config.value.model.planningModelId]
}

function repositoryTargetKey(config: RepositoryConfig): string {
	return `${config.provider}:${config.owner.toLocaleLowerCase()}/${config.name.toLocaleLowerCase()}`
}

function auditStamp(options: OpenCoreOptions, context: OperationContext): Result<AuditStamp, InvalidCoreServiceOutputError> {
	const nowResult = nowIso(options)
	if (!nowResult.ok) return nowResult

	return {
		ok: true,
		value: {
			origin: 'local',
			at: nowResult.value,
			actor: context.actor,
			correlationId: context.correlationId,
		},
	}
}

function nowIso(options: OpenCoreOptions): Result<IsoDateTime, InvalidCoreServiceOutputError> {
	const output = options.clock.now()
	const validation = validateCoreServiceOutput(coreClockOutputPipe, output, 'clock', 'now')
	if (!validation.ok) return validation

	return { ok: true, value: validation.value.toISOString() }
}

function nextId<TId extends string>(options: OpenCoreOptions, brand: string): Result<TId, InvalidCoreServiceOutputError> {
	const output = options.idGenerator.next(brand)
	const validation = validateCoreServiceOutput(coreIdOutputPipe, output, 'idGenerator', 'next')
	if (!validation.ok) return validation

	return { ok: true, value: validation.value as TId }
}

function isArchived(archivePeriods: ArchivePeriod[]): boolean {
	const latestPeriod = archivePeriods.at(-1)

	return latestPeriod !== undefined && latestPeriod.unarchived === null
}

function uniqueIds(ids: ModelId[]): ModelId[] {
	return [...new Set(ids)]
}

function storageFailure(operation: CoreStorageOperation): StorageOperationFailedError {
	return { type: 'storage-operation-failed', operation }
}
