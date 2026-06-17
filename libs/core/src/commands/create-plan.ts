import { v, type PipeOutput } from 'valleyed'

import { idPipe, nonEmptyTrimmedStringPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import { planConfigPipe } from '../domain/config'
import type { Plan } from '../domain/plan'
import type { InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { buildCommandHandler } from '../utils/command'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from '../utils/command-errors'
import {
	auditStamp,
	createRecordValue,
	getRequired,
	modelIdsFromPlanConfigRecord,
	nextId,
	normalizePlanConfigRecord,
	validateSelectableModels,
	withTransaction,
} from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const createPlanInputPipe = v.object({
	projectId: idPipe,
	title: nonEmptyTrimmedStringPipe,
	config: v.nullable(planConfigPipe),
})
export type Input = PipeOutput<typeof createPlanInputPipe>

export type Result = Plan

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCreatePlanCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createPlan', createPlanInputPipe, (input, context) => handleCreatePlan(runtime, input, context))
}

async function handleCreatePlan(runtime: CoreRuntime, input: Input, context: OperationContext): Promise<CoreResult<Plan, Error>> {
	const stampResult = auditStamp(runtime.values, context)
	if (!stampResult.ok) return stampResult

	const idResult = nextId(runtime.values, 'plan')
	if (!idResult.ok) return idResult

	return withTransaction(runtime.services, (storage) => writePlan(storage, input, stampResult.value, idResult.value))
}

async function writePlan(
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
	planId: Id,
): Promise<CoreResult<Plan, Exclude<Error, InvalidInputError>>> {
	const projectResult = await getRequired('project', storage, input.projectId)
	if (!projectResult.ok) return projectResult

	const config = normalizePlanConfigRecord(input.config, stamp)
	const configValidation = await validatePlanConfigReferences(storage, config)
	if (!configValidation.ok) return configValidation

	const plan: Plan = { id: planId, projectId: projectResult.value.id, title: input.title, config, created: stamp }
	return createRecordValue('plan', storage, plan)
}

async function validatePlanConfigReferences(
	storage: CoreStorage,
	config: ReturnType<typeof normalizePlanConfigRecord>,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	return config === null ? { ok: true, value: undefined } : validateSelectableModels(storage, modelIdsFromPlanConfigRecord(config))
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedProject } = await import('../utils/test-helpers')

	describe('createPlan command', () => {
		it('creates Plans for existing Projects without Repository setup', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(
				{ projectId: 'project-1', title: '  Plan setup  ', config: { model: { planningModelId: null } } },
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'plan-1',
					projectId: 'project-1',
					title: 'Plan setup',
					config: null,
					created: localStamp(),
				},
			})
			expect(options.tx.plans.records.get('plan-1')).toEqual(result.ok ? result.value : null)
		})
	})
}
