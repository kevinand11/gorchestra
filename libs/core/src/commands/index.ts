import { createAbandonDeliveryCommand } from './abandon-delivery'
import { createAcceptPlanOutputCommand } from './accept-plan-output'
import { createAcceptRevisionOutputCommand } from './accept-revision-output'
import { createArchiveModelCommand } from './archive-model'
import { createArchiveModelProviderCommand } from './archive-model-provider'
import { createArchiveSecretCommand } from './archive-secret'
import { createArchiveSecretBindingCommand } from './archive-secret-binding'
import { createBindSecretCommand } from './bind-secret'
import { createCloseRevisionGateCommand } from './close-revision-gate'
import { createConfigureDeliveryCommand } from './configure-delivery'
import { createCreateModelCommand } from './create-model'
import { createCreateModelProviderCommand } from './create-model-provider'
import { createCreatePlanCommand } from './create-plan'
import { createCreateProjectCommand } from './create-project'
import { createCreateRepositoryCommand } from './create-repository'
import { createCreateSecretCommand } from './create-secret'
import { createOpenRevisionGateCommand } from './open-revision-gate'
import { createPreflightModelCommand } from './preflight-model'
import { createPreflightRepositoryCommand } from './preflight-repository'
import { createQueueDeliveryCommand } from './queue-delivery'
import { createRejectPlanOutputCommand } from './reject-plan-output'
import { createReplaceSecretCommand } from './replace-secret'
import { createRetryDeliveryPreflightCommand } from './retry-delivery-preflight'
import { createRunDeliveryWorkCommand } from './run-delivery-work'
import { createSetPortfolioConfigCommand } from './set-portfolio-config'
import { createSetProjectConfigCommand } from './set-project-config'
import { createShipDeliveryCommand } from './ship-delivery'
import { createUnarchiveModelCommand } from './unarchive-model'
import { createUnarchiveModelProviderCommand } from './unarchive-model-provider'
import { createUnarchiveSecretCommand } from './unarchive-secret'
import { createUnarchiveSecretBindingCommand } from './unarchive-secret-binding'
import { createUpdateModelCommand } from './update-model'
import { createUpdateModelProviderCommand } from './update-model-provider'
import { createUpdateRepositoryConfigCommand } from './update-repository-config'
import type { OpenCoreOptions } from '../services'

export type * as AbandonDelivery from './abandon-delivery'
export type * as AcceptPlanOutput from './accept-plan-output'
export type * as AcceptRevisionOutput from './accept-revision-output'
export type * as ArchiveModel from './archive-model'
export type * as ArchiveModelProvider from './archive-model-provider'
export type * as ArchiveSecret from './archive-secret'
export type * as ArchiveSecretBinding from './archive-secret-binding'
export type * as BindSecret from './bind-secret'
export type * as CloseRevisionGate from './close-revision-gate'
export type * as ConfigureDelivery from './configure-delivery'
export type * as CreateModel from './create-model'
export type * as CreateModelProvider from './create-model-provider'
export type * as CreatePlan from './create-plan'
export type * as CreateProject from './create-project'
export type * as CreateRepository from './create-repository'
export type * as CreateSecret from './create-secret'
export type * as OpenRevisionGate from './open-revision-gate'
export type * as PreflightModel from './preflight-model'
export type * as PreflightRepository from './preflight-repository'
export type * as QueueDelivery from './queue-delivery'
export type * as RejectPlanOutput from './reject-plan-output'
export type * as ReplaceSecret from './replace-secret'
export type * as RetryDeliveryPreflight from './retry-delivery-preflight'
export type * as RunDeliveryWork from './run-delivery-work'
export type * as SetPortfolioConfig from './set-portfolio-config'
export type * as SetProjectConfig from './set-project-config'
export type * as ShipDelivery from './ship-delivery'
export type * as UnarchiveModel from './unarchive-model'
export type * as UnarchiveModelProvider from './unarchive-model-provider'
export type * as UnarchiveSecret from './unarchive-secret'
export type * as UnarchiveSecretBinding from './unarchive-secret-binding'
export type * as UpdateModel from './update-model'
export type * as UpdateModelProvider from './update-model-provider'
export type * as UpdateRepositoryConfig from './update-repository-config'

export function createCoreCommands(options: OpenCoreOptions) {
	return {
		setPortfolioConfig: createSetPortfolioConfigCommand(options),
		createModelProvider: createCreateModelProviderCommand(options),
		updateModelProvider: createUpdateModelProviderCommand(options),
		archiveModelProvider: createArchiveModelProviderCommand(options),
		unarchiveModelProvider: createUnarchiveModelProviderCommand(options),
		createModel: createCreateModelCommand(options),
		updateModel: createUpdateModelCommand(options),
		archiveModel: createArchiveModelCommand(options),
		unarchiveModel: createUnarchiveModelCommand(options),
		preflightModel: createPreflightModelCommand(),
		preflightRepository: createPreflightRepositoryCommand(),
		createPlan: createCreatePlanCommand(options),
		acceptPlanOutput: createAcceptPlanOutputCommand(),
		rejectPlanOutput: createRejectPlanOutputCommand(),
		configureDelivery: createConfigureDeliveryCommand(),
		queueDelivery: createQueueDeliveryCommand(),
		runDeliveryWork: createRunDeliveryWorkCommand(),
		retryDeliveryPreflight: createRetryDeliveryPreflightCommand(),
		openRevisionGate: createOpenRevisionGateCommand(),
		acceptRevisionOutput: createAcceptRevisionOutputCommand(),
		closeRevisionGate: createCloseRevisionGateCommand(),
		shipDelivery: createShipDeliveryCommand(),
		abandonDelivery: createAbandonDeliveryCommand(),
		createProject: createCreateProjectCommand(options),
		setProjectConfig: createSetProjectConfigCommand(options),
		createRepository: createCreateRepositoryCommand(options),
		updateRepositoryConfig: createUpdateRepositoryConfigCommand(options),
		createSecret: createCreateSecretCommand(options),
		replaceSecret: createReplaceSecretCommand(options),
		archiveSecret: createArchiveSecretCommand(options),
		unarchiveSecret: createUnarchiveSecretCommand(options),
		bindSecret: createBindSecretCommand(options),
		archiveSecretBinding: createArchiveSecretBindingCommand(options),
		unarchiveSecretBinding: createUnarchiveSecretBindingCommand(options),
	}
}

export type Core = ReturnType<typeof createCoreCommands>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestOpenCoreOptions } = await import('./test-utils')

	describe('Core commands', () => {
		it('returns an object with the expected command keys', () => {
			const commands = createCoreCommands(createTestOpenCoreOptions()) as unknown as Record<string, unknown>
			const commandNames = [
				'setPortfolioConfig',
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
				'createPlan',
				'acceptPlanOutput',
				'rejectPlanOutput',
				'configureDelivery',
				'queueDelivery',
				'runDeliveryWork',
				'retryDeliveryPreflight',
				'openRevisionGate',
				'acceptRevisionOutput',
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
				'bindSecret',
				'archiveSecretBinding',
				'unarchiveSecretBinding',
			]

			expect(Object.keys(commands).sort()).toEqual([...commandNames].sort())
			for (const commandName of commandNames) {
				expect(typeof commands[commandName]).toBe('function')
			}
		})
	})
}
