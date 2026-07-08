import {
	ensureGitRequirement,
	globalRuntimeRequirements,
	sandboxPathFromSegments,
	type AgentRunRunCommandRuntimeRequirement,
} from './agent-run-runtime-requirements'
import type { Result } from './types'
import type { AgentRunPurpose, AgentRunToolSet } from '../domain/agent-run'
import {
	firstDuplicateRuntimeRequirement,
	type AgentRunRuntimeRequirement,
	type AgentRunRuntimeRequirements,
} from '../domain/agent-run-runtime'
import type { DeliveryArtifact, SliceArtifact } from '../domain/artifact'
import type { Id } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { Plan } from '../domain/plan'
import type { Project } from '../domain/project'
import type { GitHubRepositoryConfig, Repository } from '../domain/repository'
import type { Revision, RevisionGate, RevisionScope } from '../domain/revision'
import type { Slice } from '../domain/slice'
import type { InvalidCoreServiceOutputError, InvariantViolationError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import { agentRunToolSetFromNames, readOnlyWorkspaceToolNames, writeCapableWorkspaceToolNames } from '../runtime/agent-runs/tools'
import type { CoreStorage } from '../services'
import { getRequired, listRecords } from '../storage/helpers'

type AgentRunSourceRuntimeContextError = InvalidCoreServiceOutputError | StorageOperationFailedError | ResourceNotFoundError

export type ResolveAgentRunSourceSetupError = AgentRunSourceRuntimeContextError | InvariantViolationError

export type ResolvedAgentRunSourceSetup = {
	runtimeRequirements: AgentRunRuntimeRequirements
	toolSet: AgentRunToolSet
}

type SourceSpecificAgentRunSetup = {
	runtimeRequirements: AgentRunRuntimeRequirement[]
	domainToolNames: string[]
}

type PlanningSourceRuntimeContext = {
	purpose: Extract<AgentRunPurpose, { type: 'planning' }>
	plan: Plan
	project: Project
	repositories: Repository[]
}

type ExecutionSourceRuntimeContext = {
	purpose: Extract<AgentRunPurpose, { type: 'execution' }>
	slice: Slice
	delivery: Delivery
	project: Project
	repository: Repository
}

type RevisionArtifactSourceRuntimeContext =
	| { type: 'delivery-artifact'; deliveryArtifact: DeliveryArtifact; delivery: Delivery }
	| { type: 'slice-artifact'; sliceArtifact: SliceArtifact; slice: Slice; delivery: Delivery }

type ResolvedRevisionArtifactSourceRuntimeContext = {
	scope: RevisionArtifactSourceRuntimeContext
	project: Project
	repository: Repository
}

type RevisionPlanningSourceRuntimeContext = ResolvedRevisionArtifactSourceRuntimeContext & {
	purpose: Extract<AgentRunPurpose, { type: 'revision-planning' }>
	revisionGate: RevisionGate
}

type RevisionExecutionSourceRuntimeContext = ResolvedRevisionArtifactSourceRuntimeContext & {
	purpose: Extract<AgentRunPurpose, { type: 'revision-execution' }>
	revision: Revision
}

type AgentRunSourceRuntimeContext =
	| PlanningSourceRuntimeContext
	| ExecutionSourceRuntimeContext
	| RevisionPlanningSourceRuntimeContext
	| RevisionExecutionSourceRuntimeContext

export async function resolveAgentRunSourceSetup(
	storage: CoreStorage,
	purpose: AgentRunPurpose,
): Promise<Result<ResolvedAgentRunSourceSetup, ResolveAgentRunSourceSetupError>> {
	const context = await sourceRuntimeContextForAgentRunPurpose(storage, purpose)
	if (!context.ok) return context

	const sourceSpecific = sourceSpecificSetupForContext(context.value)
	if (!sourceSpecific.ok) return sourceSpecific

	const runtimeRequirements = validateSourceRuntimeRequirements([
		...globalRuntimeRequirements,
		...sourceSpecific.value.runtimeRequirements,
	])
	if (!runtimeRequirements.ok) return runtimeRequirements

	const toolSet = agentRunToolSetFromNames([...baseToolNamesForPurpose(context.value.purpose), ...sourceSpecific.value.domainToolNames])
	return toolSet.ok ? { ok: true, value: { runtimeRequirements: runtimeRequirements.value, toolSet: toolSet.value } } : toolSet
}

async function sourceRuntimeContextForAgentRunPurpose(
	storage: CoreStorage,
	purpose: AgentRunPurpose,
): Promise<Result<AgentRunSourceRuntimeContext, AgentRunSourceRuntimeContextError>> {
	switch (purpose.type) {
		case 'planning':
			return sourceRuntimeContextForPlanning(storage, purpose)
		case 'revision-planning':
			return sourceRuntimeContextForRevisionGate(storage, purpose)
		case 'execution':
			return sourceRuntimeContextForExecution(storage, purpose)
		case 'revision-execution':
			return sourceRuntimeContextForRevision(storage, purpose)
		default:
			throw new Error(`Unexpected Agent Run Purpose: ${String(purpose satisfies never)}`)
	}
}

async function sourceRuntimeContextForPlanning(
	storage: CoreStorage,
	purpose: Extract<AgentRunPurpose, { type: 'planning' }>,
): Promise<Result<PlanningSourceRuntimeContext, AgentRunSourceRuntimeContextError>> {
	const plan = await getRequired('plan', storage, purpose.planId)
	if (!plan.ok) return plan

	const project = await getRequired('project', storage, plan.value.projectId)
	if (!project.ok) return project

	switch (project.value.source.type) {
		case 'source-control':
			return sourceControlPlanningContext(storage, purpose, plan.value, project.value)
		default:
			throw new Error(`Unexpected Project Source Type: ${String(project.value.source.type satisfies never)}`)
	}
}

async function sourceControlPlanningContext(
	storage: CoreStorage,
	purpose: Extract<AgentRunPurpose, { type: 'planning' }>,
	plan: Plan,
	project: Project,
): Promise<Result<PlanningSourceRuntimeContext, AgentRunSourceRuntimeContextError>> {
	const repositories = await listRecords('repository', storage, {
		where: (filter, fields) => filter.eq(fields.projectId, project.id),
		orderBy: [{ field: 'id', direction: 'asc' }],
	})
	return repositories.ok ? { ok: true, value: { purpose, plan, project, repositories: repositories.value } } : repositories
}

async function sourceRuntimeContextForExecution(
	storage: CoreStorage,
	purpose: Extract<AgentRunPurpose, { type: 'execution' }>,
): Promise<Result<ExecutionSourceRuntimeContext, AgentRunSourceRuntimeContextError>> {
	const slice = await getRequired('slice', storage, purpose.sliceId)
	if (!slice.ok) return slice

	const delivery = await getRequired('delivery', storage, slice.value.deliveryId)
	if (!delivery.ok) return delivery

	const project = await getRequired('project', storage, delivery.value.projectId)
	if (!project.ok) return project

	switch (project.value.source.type) {
		case 'source-control':
			return sourceControlExecutionContext(storage, purpose, slice.value, delivery.value, project.value)
		default:
			throw new Error(`Unexpected Project Source Type: ${String(project.value.source.type satisfies never)}`)
	}
}

async function sourceControlExecutionContext(
	storage: CoreStorage,
	purpose: Extract<AgentRunPurpose, { type: 'execution' }>,
	slice: Slice,
	delivery: Delivery,
	project: Project,
): Promise<Result<ExecutionSourceRuntimeContext, AgentRunSourceRuntimeContextError>> {
	const repository = await repositoryForSourceControlDelivery(storage, delivery)
	return repository.ok ? { ok: true, value: { purpose, slice, delivery, project, repository: repository.value } } : repository
}

async function sourceRuntimeContextForRevisionGate(
	storage: CoreStorage,
	purpose: Extract<AgentRunPurpose, { type: 'revision-planning' }>,
): Promise<Result<RevisionPlanningSourceRuntimeContext, AgentRunSourceRuntimeContextError>> {
	const revisionGate = await getRequired('revision-gate', storage, purpose.revisionGateId)
	if (!revisionGate.ok) return revisionGate

	const context = await revisionArtifactSourceRuntimeContext(storage, revisionGate.value.scope)
	return context.ok ? { ok: true, value: { purpose, revisionGate: revisionGate.value, ...context.value } } : context
}

async function sourceRuntimeContextForRevision(
	storage: CoreStorage,
	purpose: Extract<AgentRunPurpose, { type: 'revision-execution' }>,
): Promise<Result<RevisionExecutionSourceRuntimeContext, AgentRunSourceRuntimeContextError>> {
	const revision = await getRequired('revision', storage, purpose.revisionId)
	if (!revision.ok) return revision

	const context = await revisionArtifactSourceRuntimeContext(storage, revision.value.scope)
	return context.ok ? { ok: true, value: { purpose, revision: revision.value, ...context.value } } : context
}

async function revisionArtifactSourceRuntimeContext(
	storage: CoreStorage,
	scope: RevisionScope,
): Promise<Result<ResolvedRevisionArtifactSourceRuntimeContext, AgentRunSourceRuntimeContextError>> {
	switch (scope.type) {
		case 'delivery-artifact':
			return deliveryArtifactSourceRuntimeContext(storage, scope.deliveryArtifactId)
		case 'slice-artifact':
			return sliceArtifactSourceRuntimeContext(storage, scope.sliceArtifactId)
		default:
			throw new Error(`Unexpected Revision Scope: ${String(scope satisfies never)}`)
	}
}

async function deliveryArtifactSourceRuntimeContext(
	storage: CoreStorage,
	deliveryArtifactId: Id,
): Promise<Result<ResolvedRevisionArtifactSourceRuntimeContext, AgentRunSourceRuntimeContextError>> {
	const deliveryArtifact = await getRequired('delivery-artifact', storage, deliveryArtifactId)
	if (!deliveryArtifact.ok) return deliveryArtifact

	const delivery = await getRequired('delivery', storage, deliveryArtifact.value.deliveryId)
	if (!delivery.ok) return delivery

	const project = await getRequired('project', storage, delivery.value.projectId)
	if (!project.ok) return project

	switch (project.value.source.type) {
		case 'source-control':
			return sourceControlRevisionArtifactContext(storage, project.value, {
				type: 'delivery-artifact',
				deliveryArtifact: deliveryArtifact.value,
				delivery: delivery.value,
			})
		default:
			throw new Error(`Unexpected Project Source Type: ${String(project.value.source.type satisfies never)}`)
	}
}

async function sliceArtifactSourceRuntimeContext(
	storage: CoreStorage,
	sliceArtifactId: Id,
): Promise<Result<ResolvedRevisionArtifactSourceRuntimeContext, AgentRunSourceRuntimeContextError>> {
	const sliceArtifact = await getRequired('slice-artifact', storage, sliceArtifactId)
	if (!sliceArtifact.ok) return sliceArtifact

	const slice = await getRequired('slice', storage, sliceArtifact.value.sliceId)
	if (!slice.ok) return slice

	const delivery = await getRequired('delivery', storage, slice.value.deliveryId)
	if (!delivery.ok) return delivery

	const project = await getRequired('project', storage, delivery.value.projectId)
	if (!project.ok) return project

	switch (project.value.source.type) {
		case 'source-control':
			return sourceControlRevisionArtifactContext(storage, project.value, {
				type: 'slice-artifact',
				sliceArtifact: sliceArtifact.value,
				slice: slice.value,
				delivery: delivery.value,
			})
		default:
			throw new Error(`Unexpected Project Source Type: ${String(project.value.source.type satisfies never)}`)
	}
}

async function sourceControlRevisionArtifactContext(
	storage: CoreStorage,
	project: Project,
	scope: RevisionArtifactSourceRuntimeContext,
): Promise<Result<ResolvedRevisionArtifactSourceRuntimeContext, AgentRunSourceRuntimeContextError>> {
	const repository = await repositoryForSourceControlDelivery(storage, scope.delivery)
	return repository.ok ? { ok: true, value: { scope, project, repository: repository.value } } : repository
}

async function repositoryForSourceControlDelivery(
	storage: CoreStorage,
	delivery: Delivery,
): Promise<Result<Repository, AgentRunSourceRuntimeContextError>> {
	switch (delivery.target.type) {
		case 'source-control':
			return getRequired('repository', storage, delivery.target.repositoryId)
		default:
			throw new Error(`Unexpected Delivery Target Type: ${String(delivery.target.type satisfies never)}`)
	}
}

function sourceSpecificSetupForContext(
	context: AgentRunSourceRuntimeContext,
): Result<SourceSpecificAgentRunSetup, InvariantViolationError> {
	switch (context.project.source.type) {
		case 'source-control':
			return sourceControlSpecificSetupForContext(context)
		default:
			throw new Error(`Unexpected Project Source Type: ${String(context.project.source.type satisfies never)}`)
	}
}

function sourceControlSpecificSetupForContext(
	context: AgentRunSourceRuntimeContext,
): Result<SourceSpecificAgentRunSetup, InvariantViolationError> {
	const purposeSpecific = sourceControlPurposeSpecificSetup(context)
	return purposeSpecific.ok
		? {
				ok: true,
				value: {
					runtimeRequirements: [ensureGitRequirement, ...purposeSpecific.value.runtimeRequirements],
					domainToolNames: purposeSpecific.value.domainToolNames,
				},
			}
		: purposeSpecific
}

function sourceControlPurposeSpecificSetup(
	context: AgentRunSourceRuntimeContext,
): Result<SourceSpecificAgentRunSetup, InvariantViolationError> {
	switch (context.purpose.type) {
		case 'planning':
			if (!isPlanningSourceRuntimeContext(context)) throw new Error('Expected Planning Source Runtime Context.')
			return sourceControlPlanningSetup(context)
		case 'revision-planning':
			return { ok: true, value: { runtimeRequirements: [], domainToolNames: ['propose-revision-output'] } }
		case 'execution':
		case 'revision-execution':
			return { ok: true, value: { runtimeRequirements: [], domainToolNames: [] } }
		default:
			throw new Error(`Unexpected Agent Run Purpose: ${String(context.purpose satisfies never)}`)
	}
}

function sourceControlPlanningSetup(context: PlanningSourceRuntimeContext): Result<SourceSpecificAgentRunSetup, InvariantViolationError> {
	const requirements: AgentRunRuntimeRequirement[] = []
	for (const repository of context.repositories) {
		const requirement = planningCheckoutRequirementForRepository(repository)
		if (!requirement.ok) return requirement
		requirements.push(requirement.value)
	}
	return { ok: true, value: { runtimeRequirements: requirements, domainToolNames: ['propose-plan-output'] } }
}

function baseToolNamesForPurpose(purpose: AgentRunPurpose): readonly string[] {
	switch (purpose.type) {
		case 'planning':
		case 'revision-planning':
			return readOnlyWorkspaceToolNames
		case 'execution':
		case 'revision-execution':
			return writeCapableWorkspaceToolNames
		default:
			throw new Error(`Unexpected Agent Run Purpose: ${String(purpose satisfies never)}`)
	}
}

function isPlanningSourceRuntimeContext(context: AgentRunSourceRuntimeContext): context is PlanningSourceRuntimeContext {
	return context.purpose.type === 'planning'
}

function planningCheckoutRequirementForRepository(
	repository: Repository,
): Result<AgentRunRunCommandRuntimeRequirement, InvariantViolationError> {
	const config = repository.config
	switch (config.provider) {
		case 'github':
			return githubPlanningCheckoutRequirement({ ...repository, config })
		default:
			throw new Error(`Unexpected Repository Provider: ${String(config.provider)}`)
	}
}

const sourceControlTokenEnvName = 'GORCHESTRA_SOURCE_CONTROL_TOKEN'

function githubPlanningCheckoutRequirement(
	repository: Repository & { config: GitHubRepositoryConfig },
): Result<AgentRunRunCommandRuntimeRequirement, InvariantViolationError> {
	const checkoutPath = sandboxPathFromSegments([repository.config.owner, repository.config.name, repository.id], '-')
	if (!checkoutPath.ok) return checkoutPath

	return {
		ok: true,
		value: {
			type: 'run-command',
			label: `Checkout GitHub repository ${repository.config.owner}/${repository.config.name}`,
			command: {
				executable: 'sh',
				args: ['-c', githubPlanningCheckoutScript(repository.config, checkoutPath.value)],
				cwd: '/workspace',
			},
			root: false,
			commandSecretEnv: { [sourceControlTokenEnvName]: repository.config.secretId },
		},
	}
}

function githubPlanningCheckoutScript(config: GitHubRepositoryConfig, checkoutPath: string): string {
	const owner = shellSingleQuote(config.owner)
	const name = shellSingleQuote(config.name)
	const path = shellSingleQuote(checkoutPath)
	return `set -eu
repo_owner=${owner}
repo_name=${name}
checkout_path=${path}
repo_url="https://x-access-token:\${${sourceControlTokenEnvName}}@github.com/\${repo_owner}/\${repo_name}.git"

rm -rf "$checkout_path"
GIT_TERMINAL_PROMPT=0 git -c credential.helper= clone --depth 1 "$repo_url" "$checkout_path"
git -C "$checkout_path" remote set-url origin "https://github.com/\${repo_owner}/\${repo_name}.git"
test -d "$checkout_path/.git"
`
}

function shellSingleQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`
}

function validateSourceRuntimeRequirements(
	requirements: AgentRunRuntimeRequirement[],
): Result<AgentRunRuntimeRequirements, InvariantViolationError> {
	const duplicate = firstDuplicateRuntimeRequirement(requirements)
	return duplicate === null
		? { ok: true, value: requirements }
		: invariant(`Source runtime requirements included duplicate requirement ${duplicate.type}.`)
}

function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, localStamp, seedDelivery, seedProject, seedSlice, stamp } = await import('./test-helpers')

	describe('resolveAgentRunSourceSetup', () => {
		it('resolves source-control planning source requirements through Plan to Project', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			options.tx.plans.records.set('01k00000000000000000000028', {
				id: '01k00000000000000000000028',
				projectId: '01k00000000000000000000030',
				agentRunId: '01k00000000000000000000002',
				title: 'Plan',
				created: localStamp(),
				closed: null,
			})

			await expect(
				resolveAgentRunSourceSetup(options.storage, {
					type: 'planning',
					planId: '01k00000000000000000000028',
				}),
			).resolves.toEqual({
				ok: true,
				value: {
					runtimeRequirements: [...globalRuntimeRequirements, ensureGitRequirement],
					toolSet: toolSet(['read', 'grep', 'find', 'ls', 'propose-plan-output']),
				},
			})
		})

		it('adds Source Control Planning checkout requirements for Project repositories in id order', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			options.tx.plans.records.set('01k00000000000000000000028', {
				id: '01k00000000000000000000028',
				projectId: '01k00000000000000000000030',
				agentRunId: '01k00000000000000000000002',
				title: 'Plan',
				created: localStamp(),
				closed: null,
			})
			options.tx.repositories.records.set('01k00000000000000000000035', {
				id: '01k00000000000000000000035',
				projectId: '01k00000000000000000000030',
				config: { provider: 'github', owner: 'Beta Owner', name: 'Second Repo', secretId: '01k00000000000000000000041' },
				created: stamp,
			})
			options.tx.repositories.records.set('01k00000000000000000000034', {
				id: '01k00000000000000000000034',
				projectId: '01k00000000000000000000030',
				config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: '01k00000000000000000000040' },
				created: stamp,
			})

			const result = await resolveAgentRunSourceSetup(options.storage, {
				type: 'planning',
				planId: '01k00000000000000000000028',
			})

			if (!result.ok) throw new Error('Expected source setup resolution to pass.')
			expect(result.value.runtimeRequirements.map(runtimeRequirementLabel)).toEqual([
				'Verify POSIX shell is available',
				'Ensure rg and fd are available',
				'Ensure Git is available',
				'Checkout GitHub repository Octo/Repo',
				'Checkout GitHub repository Beta Owner/Second Repo',
			])
			expect(result.value.toolSet).toEqual(toolSet(['read', 'grep', 'find', 'ls', 'propose-plan-output']))
			const checkout = result.value.runtimeRequirements[3]
			if (checkout === undefined || checkout.type !== 'run-command')
				throw new Error('Expected checkout requirement to be a run command.')
			expect(checkout).toMatchObject({
				type: 'run-command',
				label: 'Checkout GitHub repository Octo/Repo',
				command: { executable: 'sh', cwd: '/workspace' },
				root: false,
				commandSecretEnv: { GORCHESTRA_SOURCE_CONTROL_TOKEN: '01k00000000000000000000040' },
			})
			expect(checkout.command.args[1]).toContain("repo_owner='Octo'")
			expect(checkout.command.args[1]).toContain("repo_name='Repo'")
			expect(checkout.command.args[1]).toContain("checkout_path='/workspace/Octo-Repo-01k00000000000000000000034'")
			expect(checkout.command.args[1]).toContain('git -c credential.helper= clone --depth 1 "$repo_url" "$checkout_path"')
			expect(checkout.command.args[1]).toContain('remote set-url origin "https://github.com/${repo_owner}/${repo_name}.git"')
			expect(checkout.command.args[1]).toContain('test -d "$checkout_path/.git"')
		})

		it('resolves source-control execution source requirements through Slice and Delivery to Project', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, '01k00000000000000000000008')
			seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')

			await expect(
				resolveAgentRunSourceSetup(options.storage, {
					type: 'execution',
					deliveryId: '01k00000000000000000000008',
					sliceId: '01k00000000000000000000042',
					mode: { type: 'initial' },
				}),
			).resolves.toEqual({
				ok: true,
				value: {
					runtimeRequirements: [...globalRuntimeRequirements, ensureGitRequirement],
					toolSet: toolSet(['read', 'grep', 'find', 'ls', 'sh', 'edit', 'write']),
				},
			})
		})

		it('resolves source-control revision planning source requirements through a Slice Artifact scope', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, '01k00000000000000000000008')
			seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')
			seedSliceArtifact(options.tx, '01k00000000000000000000045', '01k00000000000000000000042')
			options.tx.revisionGates.records.set('01k00000000000000000000046', {
				id: '01k00000000000000000000046',
				agentRunId: '01k00000000000000000000002',
				scope: {
					type: 'slice-artifact',
					sliceId: '01k00000000000000000000042',
					sliceArtifactId: '01k00000000000000000000045',
				},
				reviewSurfaceId: '01k00000000000000000000037',
				opened: stamp,
				closed: null,
			})

			await expect(
				resolveAgentRunSourceSetup(options.storage, {
					type: 'revision-planning',
					revisionGateId: '01k00000000000000000000046',
				}),
			).resolves.toEqual({
				ok: true,
				value: {
					runtimeRequirements: [...globalRuntimeRequirements, ensureGitRequirement],
					toolSet: toolSet(['read', 'grep', 'find', 'ls', 'propose-revision-output']),
				},
			})
		})

		it('resolves source-control revision execution source requirements through a Revision scope and ignores action id', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, '01k00000000000000000000008')
			seedDeliveryArtifact(options.tx, '01k00000000000000000000010', '01k00000000000000000000008')
			options.tx.revisions.records.set('01k00000000000000000000047', {
				id: '01k00000000000000000000047',
				revisionGateId: '01k00000000000000000000046',
				scope: {
					type: 'delivery-artifact',
					deliveryId: '01k00000000000000000000008',
					deliveryArtifactId: '01k00000000000000000000010',
				},
				instruction: { body: 'Revise.' },
				disposition: { body: 'Respond to feedback.' },
				accepted: stamp,
			})

			await expect(
				resolveAgentRunSourceSetup(options.storage, {
					type: 'revision-execution',
					revisionId: '01k00000000000000000000047',
					actionId: '01k00000000000000000000099',
				}),
			).resolves.toEqual({
				ok: true,
				value: {
					runtimeRequirements: [...globalRuntimeRequirements, ensureGitRequirement],
					toolSet: toolSet(['read', 'grep', 'find', 'ls', 'sh', 'edit', 'write']),
				},
			})
		})
	})

	describe('validateSourceRuntimeRequirements', () => {
		it('returns invariant violations for duplicate source requirements', () => {
			const requirement: AgentRunRuntimeRequirement = {
				type: 'environment-secret',
				envName: 'NPM_TOKEN',
				secretId: '01k00000000000000000000040',
			}

			expect(validateSourceRuntimeRequirements([requirement, requirement])).toEqual({
				ok: false,
				error: {
					type: 'invariant-violation',
					message: 'Source runtime requirements included duplicate requirement environment-secret.',
				},
			})
		})
	})

	function toolSet(names: string[]): AgentRunToolSet {
		return names.map((name) => ({ name, contractVersion: 1 }))
	}

	function runtimeRequirementLabel(requirement: AgentRunRuntimeRequirement): string {
		switch (requirement.type) {
			case 'environment-secret':
				return `Set environment variable ${requirement.envName}`
			case 'run-command':
				return requirement.label
			default:
				throw new Error(`Unexpected runtime requirement type: ${String(requirement satisfies never)}`)
		}
	}

	function seedDeliveryArtifact(tx: ReturnType<typeof createTestCoreServices>['tx'], id: Id, deliveryId: Id) {
		tx.deliveryArtifacts.records.set(id, {
			id,
			deliveryId,
			config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
			created: { at: '2026-06-10T12:00:00.000Z' },
		})
	}

	function seedSliceArtifact(tx: ReturnType<typeof createTestCoreServices>['tx'], id: Id, sliceId: Id) {
		tx.sliceArtifacts.records.set(id, {
			id,
			sliceId,
			config: { type: 'source-control', sliceBranch: 'slice-branch' },
			created: { at: '2026-06-10T12:00:00.000Z' },
		})
	}
}
