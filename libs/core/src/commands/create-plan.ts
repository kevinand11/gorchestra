import { v, type PipeOutput } from 'valleyed'

import { idPipe, nonEmptyTrimmedStringPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import { planConfigPipe } from '../domain/config'
import { type Plan } from '../domain/plan'
import { projectPipe } from '../domain/project'
import type { InvalidInputError } from '../errors'
import type { CoreServices, CoreStorageTransaction } from '../services'
import { buildCommandHandler } from '../utils/command'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from '../utils/command-errors'
import {
	auditStamp,
	getRequired,
	modelIdsFromPlanConfigRecord,
	nextId,
	normalizePlanConfigRecord,
	putRecord,
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

export function createCreatePlanCommand(options: CoreServices): Operation {
	return buildCommandHandler('createPlan', createPlanInputPipe, (input, context) => handleCreatePlan(options, input, context))
}

async function handleCreatePlan(options: CoreServices, input: Input, context: OperationContext): Promise<CoreResult<Plan, Error>> {
	const stampResult = auditStamp(options, context)
	if (!stampResult.ok) return stampResult

	const idResult = nextId(options, 'plan')
	if (!idResult.ok) return idResult

	return withTransaction(options, (tx) => writePlan(tx, input, stampResult.value, idResult.value))
}

async function writePlan(
	tx: CoreStorageTransaction,
	input: Input,
	stamp: AuditStamp,
	planId: Id,
): Promise<CoreResult<Plan, Exclude<Error, InvalidInputError>>> {
	const projectResult = await getRequired('project', tx.projects, input.projectId, projectPipe)
	if (!projectResult.ok) return projectResult

	const config = normalizePlanConfigRecord(input.config, stamp)
	const configValidation = await validatePlanConfigReferences(tx, config)
	if (!configValidation.ok) return configValidation

	const plan: Plan = { id: planId, projectId: projectResult.value.id, title: input.title, config, created: stamp }
	const putResult = await putRecord('plan', tx.plans, plan.id, plan)
	if (!putResult.ok) return putResult

	return { ok: true, value: plan }
}

async function validatePlanConfigReferences(
	tx: CoreStorageTransaction,
	config: ReturnType<typeof normalizePlanConfigRecord>,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	return config === null ? { ok: true, value: undefined } : validateSelectableModels(tx, modelIdsFromPlanConfigRecord(config))
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedProject } = await import('../utils/test-helpers')

	describe('createPlan command', () => {
		it('creates Plans for existing Projects without Repository setup', async () => {
			const options = createTestOpenCoreOptions()
			seedProject(options.tx, 'project-1')
			const command = createCreatePlanCommand(options)

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
