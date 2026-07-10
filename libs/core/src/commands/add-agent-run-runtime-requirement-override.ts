import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunEvent } from '../domain/agent-run-event'
import { agentRunRuntimeRequirementsPipe, firstDuplicateRuntimeRequirement, runtimeRequirementKey } from '../domain/agent-run-runtime'
import { idPipe } from '../domain/commons'
import type {
	AgentRunNotActiveError,
	DuplicateAgentRunRuntimeRequirementError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	ResourceArchivedError,
	StorageOperationFailedError,
} from '../errors'
import { appendAgentRunEvent } from '../utils/agent-runs'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from '../utils/command-errors'
import { buildCommandHandler } from '../utils/command-handler'
import { getRequired, runtimeRecord, updateRecordValue, withAuditStampTransaction } from '../utils/command-storage'
import { acceptAgentRunPreparation } from '../utils/dispatch'
import type { CoreRuntime } from '../utils/runtime'
import { validateRuntimeRequirementSecretReferences } from '../utils/runtime-requirement-secrets'
import type { Result as CoreResult } from '../utils/types'

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
	| ResourceArchivedError
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
					{ requirements: input.requirements, added: stamp, eventId: event.value.id },
				]
				const desiredRuntimeRequirements = [...agentRun.value.desiredRuntimeRequirements, ...input.requirements]
				const updated = await updateRecordValue('agent-run', storage, input.agentRunId, {
					runtimeRequirementOverrides,
					desiredRuntimeRequirements,
					blocked: { type: 'preparation-pending', blocked: blocked.value },
				})
				if (!updated.ok) return updated

				const dispatchMarker = await acceptAgentRunPreparation(runtime.services.dispatcher, input.agentRunId, {
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
		it('appends an override batch for active autonomous Agent Runs and dispatches Agent Run preparation', async () => {
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
			seedSecret(options.tx, '01k00000000000000000000040')
			options.tx.agentRuns.records.set(
				'01k00000000000000000000002',
				testModelAgentRun({
					purpose: {
						type: 'execution',
						deliveryId: '01k00000000000000000000008',
						sliceId: '01k00000000000000000000042',
						mode: { type: 'initial' },
					},
				}),
			)
			const command = createAddAgentRunRuntimeRequirementOverrideCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					agentRunId: '01k00000000000000000000002',
					requirements: [{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: '01k00000000000000000000040' }],
				},
				context,
			)

			expect(result).toMatchObject({
				ok: true,
				value: { body: { type: 'agent-run-runtime-requirement-override-added' }, id: '01k00000000000000000010001' },
			})
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')).toMatchObject({
				blocked: { type: 'preparation-pending' },
				desiredRuntimeRequirements: [{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: '01k00000000000000000000040' }],
				runtimeRequirementOverrides: [{ eventId: '01k00000000000000000010001' }],
			})
			expect(dispatches).toEqual([
				{
					type: 'agent-run-preparation',
					agentRunId: '01k00000000000000000000002',
					coordinationClaims: [
						{
							scope: [{ type: 'agent-run', id: '01k00000000000000000000002' }],
							mode: { type: 'exclusive' },
						},
					],
					reason: { type: 'runtime-requirement-override-added', eventId: '01k00000000000000000010001' },
				},
			])
			expect(readyMarkers).toEqual(['marker-1'])
		})

		it('rejects completed Agent Runs', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, '01k00000000000000000000040')
			options.tx.agentRuns.records.set(
				'01k00000000000000000000002',
				testModelAgentRun({ completed: { at: '2026-06-10T12:10:00.000Z' } }),
			)
			const command = createAddAgentRunRuntimeRequirementOverrideCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					agentRunId: '01k00000000000000000000002',
					requirements: [{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: '01k00000000000000000000040' }],
				},
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-active', agentRunId: '01k00000000000000000000002' } })
		})
	})
}
