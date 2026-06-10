import { v, type PipeOutput } from 'valleyed'

import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './errors'
import {
	auditStamp,
	getRequired,
	modelIdsFromPlanConfigRecord,
	nextId,
	normalizePlanConfigRecord,
	putRecord,
	validateSelectableModels,
	withTransaction,
} from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import { planConfigPipe } from '../domain/config'
import { type Plan } from '../domain/plan'
import { projectPipe } from '../domain/project'
import type { InvalidInputError } from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../types'

const createPlanInputPipe = v.object({
	projectId: idPipe,
	title: nonEmptyTrimmedStringPipe,
	config: v.nullable(planConfigPipe),
})
export type Input = PipeOutput<typeof createPlanInputPipe>

export type Result = Plan

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCreatePlanCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('createPlan', createPlanInputPipe, (input, context) => {
		const stampResult = auditStamp(options, context)
		if (!stampResult.ok) return Promise.resolve(stampResult)

		const idResult = nextId(options, 'plan')
		if (!idResult.ok) return Promise.resolve(idResult)

		// fallow-ignore-next-line complexity
		return withTransaction(options, async (tx): Promise<CoreResult<Plan, Exclude<Error, InvalidInputError>>> => {
			const projectResult = await getRequired('project', tx.projects, input.projectId, projectPipe)
			if (!projectResult.ok) return projectResult

			const config = normalizePlanConfigRecord(input.config, stampResult.value)
			if (config !== null) {
				const referenceValidation = await validateSelectableModels(tx, modelIdsFromPlanConfigRecord(config))
				if (!referenceValidation.ok) return referenceValidation
			}

			const plan: Plan = {
				id: idResult.value,
				projectId: projectResult.value.id,
				title: input.title,
				config,
				created: stampResult.value,
			}
			const putResult = await putRecord('plan', tx.plans, plan.id, plan)
			if (!putResult.ok) return putResult

			return { ok: true, value: plan }
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedProject } = await import('./test-utils')

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
