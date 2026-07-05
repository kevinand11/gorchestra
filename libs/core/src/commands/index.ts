import { createAbandonDeliveryCommand } from './abandon-delivery'
import { createAcceptPlanOutputCommand } from './accept-plan-output'
import { createAcceptRevisionOutputCommand } from './accept-revision-output'
import { createAddAgentRunRuntimeRequirementOverrideCommand } from './add-agent-run-runtime-requirement-override'
import { createArchiveAgentRunProfileCommand } from './archive-agent-run-profile'
import { createArchiveModelCommand } from './archive-model'
import { createArchiveModelProviderCommand } from './archive-model-provider'
import { createArchiveSecretCommand } from './archive-secret'
import { createClosePlanCommand } from './close-plan'
import { createCloseRevisionGateCommand } from './close-revision-gate'
import { createCompactAgentRunContextCommand } from './compact-agent-run-context'
import { createConfigureDeliveryCommand } from './configure-delivery'
import { createCreateAgentRunProfileCommand } from './create-agent-run-profile'
import { createCreateMemoryCommand } from './create-memory'
import { createCreateMemoryRevisionCommand } from './create-memory-revision'
import { createCreateModelCommand } from './create-model'
import { createCreateModelProviderCommand } from './create-model-provider'
import { createCreatePlanCommand } from './create-plan'
import { createCreateProjectCommand } from './create-project'
import { createCreateRepositoryCommand } from './create-repository'
import { createCreateSecretCommand } from './create-secret'
import { createInterruptAgentRunCommand } from './interrupt-agent-run'
import { createOpenRevisionGateCommand } from './open-revision-gate'
import { createPreflightModelCommand } from './preflight-model'
import { createPreflightRepositoryCommand } from './preflight-repository'
import { createQueueDeliveryCommand } from './queue-delivery'
import { createRejectPlanOutputCommand } from './reject-plan-output'
import { createRejectRevisionOutputCommand } from './reject-revision-output'
import { createReplaceSecretCommand } from './replace-secret'
import { createRetryDeliveryPreflightCommand } from './retry-delivery-preflight'
import { createSendAgentRunMessageCommand } from './send-agent-run-message'
import { createSetAgentRunModelUseOverrideCommand } from './set-agent-run-model-use-override'
import { createSetProjectConfigCommand } from './set-project-config'
import { createShipDeliveryCommand } from './ship-delivery'
import { createUnarchiveAgentRunProfileCommand } from './unarchive-agent-run-profile'
import { createUnarchiveModelCommand } from './unarchive-model'
import { createUnarchiveModelProviderCommand } from './unarchive-model-provider'
import { createUnarchiveSecretCommand } from './unarchive-secret'
import { createUpdateAgentRunProfileCommand } from './update-agent-run-profile'
import { createUpdateModelCommand } from './update-model'
import { createUpdateModelProviderCommand } from './update-model-provider'
import { createUpdateRepositoryConfigCommand } from './update-repository-config'
import type { CoreRuntime } from '../runtime'

export type * as AbandonDelivery from './abandon-delivery'
export type * as AcceptPlanOutput from './accept-plan-output'
export type * as AcceptRevisionOutput from './accept-revision-output'
export type * as AddAgentRunRuntimeRequirementOverride from './add-agent-run-runtime-requirement-override'
export type * as ArchiveAgentRunProfile from './archive-agent-run-profile'
export type * as ArchiveModel from './archive-model'
export type * as ArchiveModelProvider from './archive-model-provider'
export type * as ArchiveSecret from './archive-secret'
export type * as ClosePlan from './close-plan'
export type * as CloseRevisionGate from './close-revision-gate'
export type * as CompactAgentRunContext from './compact-agent-run-context'
export type * as ConfigureDelivery from './configure-delivery'
export type * as CreateAgentRunProfile from './create-agent-run-profile'
export type * as CreateModel from './create-model'
export type * as CreateMemory from './create-memory'
export type * as CreateMemoryRevision from './create-memory-revision'
export type * as CreateModelProvider from './create-model-provider'
export type * as CreatePlan from './create-plan'
export type * as CreateProject from './create-project'
export type * as CreateRepository from './create-repository'
export type * as CreateSecret from './create-secret'
export type * as InterruptAgentRun from './interrupt-agent-run'
export type * as OpenRevisionGate from './open-revision-gate'
export type * as PreflightModel from './preflight-model'
export type * as PreflightRepository from './preflight-repository'
export type * as QueueDelivery from './queue-delivery'
export type * as RejectPlanOutput from './reject-plan-output'
export type * as RejectRevisionOutput from './reject-revision-output'
export type * as ReplaceSecret from './replace-secret'
export type * as RetryDeliveryPreflight from './retry-delivery-preflight'
export type * as SendAgentRunMessage from './send-agent-run-message'
export type * as SetAgentRunModelUseOverride from './set-agent-run-model-use-override'
export type * as SetProjectConfig from './set-project-config'
export type * as ShipDelivery from './ship-delivery'
export type * as UnarchiveAgentRunProfile from './unarchive-agent-run-profile'
export type * as UnarchiveModel from './unarchive-model'
export type * as UnarchiveModelProvider from './unarchive-model-provider'
export type * as UnarchiveSecret from './unarchive-secret'
export type * as UpdateAgentRunProfile from './update-agent-run-profile'
export type * as UpdateModel from './update-model'
export type * as UpdateModelProvider from './update-model-provider'
export type * as UpdateRepositoryConfig from './update-repository-config'

export function createCoreCommands(runtime: CoreRuntime) {
	return {
		createAgentRunProfile: createCreateAgentRunProfileCommand(runtime),
		updateAgentRunProfile: createUpdateAgentRunProfileCommand(runtime),
		archiveAgentRunProfile: createArchiveAgentRunProfileCommand(runtime),
		unarchiveAgentRunProfile: createUnarchiveAgentRunProfileCommand(runtime),
		createModelProvider: createCreateModelProviderCommand(runtime),
		updateModelProvider: createUpdateModelProviderCommand(runtime),
		archiveModelProvider: createArchiveModelProviderCommand(runtime),
		unarchiveModelProvider: createUnarchiveModelProviderCommand(runtime),
		createModel: createCreateModelCommand(runtime),
		updateModel: createUpdateModelCommand(runtime),
		archiveModel: createArchiveModelCommand(runtime),
		unarchiveModel: createUnarchiveModelCommand(runtime),
		preflightModel: createPreflightModelCommand(runtime),
		preflightRepository: createPreflightRepositoryCommand(runtime),
		createMemory: createCreateMemoryCommand(runtime),
		createMemoryRevision: createCreateMemoryRevisionCommand(runtime),
		createPlan: createCreatePlanCommand(runtime),
		sendAgentRunMessage: createSendAgentRunMessageCommand(runtime),
		addAgentRunRuntimeRequirementOverride: createAddAgentRunRuntimeRequirementOverrideCommand(runtime),
		closePlan: createClosePlanCommand(runtime),
		interruptAgentRun: createInterruptAgentRunCommand(runtime),
		setAgentRunModelUseOverride: createSetAgentRunModelUseOverrideCommand(runtime),
		compactAgentRunContext: createCompactAgentRunContextCommand(runtime),
		acceptPlanOutput: createAcceptPlanOutputCommand(runtime),
		rejectPlanOutput: createRejectPlanOutputCommand(runtime),
		configureDelivery: createConfigureDeliveryCommand(runtime),
		queueDelivery: createQueueDeliveryCommand(runtime),
		retryDeliveryPreflight: createRetryDeliveryPreflightCommand(runtime),
		openRevisionGate: createOpenRevisionGateCommand(runtime),
		acceptRevisionOutput: createAcceptRevisionOutputCommand(runtime),
		rejectRevisionOutput: createRejectRevisionOutputCommand(runtime),
		closeRevisionGate: createCloseRevisionGateCommand(runtime),
		shipDelivery: createShipDeliveryCommand(runtime),
		abandonDelivery: createAbandonDeliveryCommand(runtime),
		createProject: createCreateProjectCommand(runtime),
		setProjectConfig: createSetProjectConfigCommand(runtime),
		createRepository: createCreateRepositoryCommand(runtime),
		updateRepositoryConfig: createUpdateRepositoryConfigCommand(runtime),
		createSecret: createCreateSecretCommand(runtime),
		replaceSecret: createReplaceSecretCommand(runtime),
		archiveSecret: createArchiveSecretCommand(runtime),
		unarchiveSecret: createUnarchiveSecretCommand(runtime),
	}
}

export type Core = ReturnType<typeof createCoreCommands>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createCoreRuntime } = await import('../runtime')
	const { createTestCoreServices } = await import('../utils/test-helpers')

	describe('Core commands', () => {
		it('returns an object with the expected command keys', () => {
			const commands = createCoreCommands(createCoreRuntime(createTestCoreServices())) as unknown as Record<string, unknown>
			const commandNames = [
				'createAgentRunProfile',
				'updateAgentRunProfile',
				'archiveAgentRunProfile',
				'unarchiveAgentRunProfile',
				'createModelProvider',
				'updateModelProvider',
				'archiveModelProvider',
				'unarchiveModelProvider',
				'createModel',
				'updateModel',
				'archiveModel',
				'unarchiveModel',
				'preflightModel',
				'preflightRepository',
				'createMemory',
				'createMemoryRevision',
				'createPlan',
				'sendAgentRunMessage',
				'addAgentRunRuntimeRequirementOverride',
				'closePlan',
				'interruptAgentRun',
				'setAgentRunModelUseOverride',
				'compactAgentRunContext',
				'acceptPlanOutput',
				'rejectPlanOutput',
				'configureDelivery',
				'queueDelivery',
				'retryDeliveryPreflight',
				'openRevisionGate',
				'acceptRevisionOutput',
				'rejectRevisionOutput',
				'closeRevisionGate',
				'shipDelivery',
				'abandonDelivery',
				'createProject',
				'setProjectConfig',
				'createRepository',
				'updateRepositoryConfig',
				'createSecret',
				'replaceSecret',
				'archiveSecret',
				'unarchiveSecret',
			]

			expect(Object.keys(commands).sort()).toEqual([...commandNames].sort())
			for (const commandName of commandNames) {
				expect(typeof commands[commandName]).toBe('function')
			}
		})
	})
}
