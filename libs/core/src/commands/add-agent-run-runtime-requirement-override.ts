import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunEvent } from '../domain/agent-run'
import { agentRunRuntimeRequirementsPipe, firstDuplicateRuntimeRequirement, runtimeRequirementKey } from '../domain/agent-run-runtime'
import { idPipe } from '../domain/commons'
import type {
	AgentRunNotActiveError,
	ArchivedSecretReferenceError,
	DuplicateAgentRunRuntimeRequirementError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import { appendAgentRunEvent } from '../utils/agent-run-events'
import type { Result as CoreResult } from '../utils/types'
import { acceptAgentRunSandboxPreparation } from './utils/dispatch'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	getRequired,
	runtimeRecord,
	updateRecordValue,
	validateRuntimeRequirementSecretReferences,
	withAuditStampTransaction,
} from './utils/storage'

const nonEmptyRuntimeRequirementsPipe = agentRunRuntimeRequirementsPipe.pipe(
	v.custom((requirements) => requirements.length > 0, 'Expected at least one Agent Run Runtime Requirement.'),
)
const inputPipe = v.object({ agentRunId: idPipe, requirements: nonEmptyRuntimeRequirementsPipe })
export type Input = PipeOutput<typeof inputPipe>

export type Result = AgentRunEvent
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| AgentRunNotActiveError
	| ConfigCommandReferenceError
	| ConfigCommandStorageError
	| ArchivedSecretReferenceError
	| DuplicateAgentRunRuntimeRequirementError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type WrittenOverride = { event: Result; dispatchMarker: string }

export function createAddAgentRunRuntimeRequirementOverrideCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('addAgentRunRuntimeRequirementOverride', inputPipe, async (input, context) => {
		const written = await withAuditStampTransaction(
			runtime,
			context,
			async (storage, stamp): Promise<CoreResult<WrittenOverride, Exclude<Error, InvalidInputError>>> => {
				const duplicateRequirement = firstDuplicateRuntimeRequirement(input.requirements)
				if (duplicateRequirement !== null) return duplicateRuntimeRequirement(duplicateRequirement)

				const agentRun = await getRequired('agent-run', storage, input.agentRunId)
				if (!agentRun.ok) return agentRun
				if (agentRun.value.completed !== null)
					return { ok: false, error: { type: 'agent-run-not-active', agentRunId: input.agentRunId } }

				const duplicateExisting = input.requirements.find((requirement) =>
					new Set(agentRun.value.desiredRuntimeRequirements.map(runtimeRequirementKey)).has(runtimeRequirementKey(requirement)),
				)
				if (duplicateExisting !== undefined) return duplicateRuntimeRequirement(duplicateExisting)

				const secretValidation = await validateRuntimeRequirementSecretReferences(storage, input.requirements)
				if (!secretValidation.ok) return secretValidation

				const blocked = runtimeRecord(runtime.values)
				if (!blocked.ok) return blocked

				const event = await appendAgentRunEvent(runtime, storage, input.agentRunId, {
					type: 'agent-run-runtime-requirement-override-added',
					requirements: input.requirements,
					authorized: stamp,
				})
				if (!event.ok) return event

				const runtimeRequirementOverrides = [
					...agentRun.value.runtimeRequirementOverrides,
					{ requirements: input.requirements, added: stamp, eventId: event.value.id, eventCursor: event.value.cursor },
				]
				const desiredRuntimeRequirements = [...agentRun.value.desiredRuntimeRequirements, ...input.requirements]
				const updated = await updateRecordValue('agent-run', storage, input.agentRunId, {
					runtimeRequirementOverrides,
					desiredRuntimeRequirements,
					blocked: { type: 'sandbox-preparation-pending', blocked: blocked.value },
				})
				if (!updated.ok) return updated

				const dispatchMarker = await acceptAgentRunSandboxPreparation(runtime.services.dispatcher, input.agentRunId, {
					type: 'runtime-requirement-override-added',
					eventId: event.value.id,
				})
				if (!dispatchMarker.ok) return dispatchMarker

				return { ok: true, value: { event: event.value, dispatchMarker: dispatchMarker.value } }
			},
		)
		if (!written.ok) return written

		runtime.services.dispatcher.ready(written.value.dispatchMarker)
		return { ok: true, value: written.value.event }
	})
}

function duplicateRuntimeRequirement(
	requirement: Input['requirements'][number],
): CoreResult<never, DuplicateAgentRunRuntimeRequirementError> {
	return { ok: false, error: { type: 'duplicate-agent-run-runtime-requirement', requirement } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, seedSecret, testModelAgentRun } = await import('../utils/test-helpers')

	describe('addAgentRunRuntimeRequirementOverride command', () => {
		it('appends an override batch for active autonomous Agent Runs and dispatches sandbox preparation', async () => {
			const dispatches: unknown[] = []
			const readyMarkers: string[] = []
			const options = createTestCoreServices({
				dispatcher: {
					preflight: () => Promise.resolve({ ok: true }),
					request: (request) => {
						dispatches.push(request)
						return Promise.resolve('marker-1')
					},
					ready: (marker) => readyMarkers.push(marker),
				},
			})
			seedSecret(options.tx, 'secret-1')
			options.tx.agentRuns.records.set(
				'agent-run-1',
				testModelAgentRun({
					purpose: { type: 'execution', deliveryId: 'delivery-1', sliceId: 'slice-1', mode: { type: 'initial' } },
				}),
			)
			const command = createAddAgentRunRuntimeRequirementOverrideCommand(createTestCoreRuntime(options))

			const result = await command(
				{ agentRunId: 'agent-run-1', requirements: [{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: 'secret-1' }] },
				context,
			)

			expect(result).toMatchObject({
				ok: true,
				value: { body: { type: 'agent-run-runtime-requirement-override-added' }, cursor: '01J00000000000000000000001' },
			})
			expect(options.tx.agentRuns.records.get('agent-run-1')).toMatchObject({
				blocked: { type: 'sandbox-preparation-pending' },
				desiredRuntimeRequirements: [{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: 'secret-1' }],
				runtimeRequirementOverrides: [{ eventCursor: '01J00000000000000000000001' }],
			})
			expect(dispatches).toEqual([
				{
					type: 'agent-run-sandbox-preparation',
					agentRunId: 'agent-run-1',
					coordinationClaims: [
						{
							scope: [{ type: 'agent-run', id: 'agent-run-1' }],
							mode: { type: 'exclusive' },
						},
					],
					reason: { type: 'runtime-requirement-override-added', eventId: 'agent-run-event-1' },
				},
			])
			expect(readyMarkers).toEqual(['marker-1'])
		})

		it('rejects completed Agent Runs', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, 'secret-1')
			options.tx.agentRuns.records.set('agent-run-1', testModelAgentRun({ completed: { at: '2026-06-10T12:10:00.000Z' } }))
			const command = createAddAgentRunRuntimeRequirementOverrideCommand(createTestCoreRuntime(options))

			const result = await command(
				{ agentRunId: 'agent-run-1', requirements: [{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: 'secret-1' }] },
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-active', agentRunId: 'agent-run-1' } })
		})
	})
}
