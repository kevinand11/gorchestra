import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { nonEmptyTrimmedStringPipe } from '../domain/commons'
import {
	modelProviderAuthPipe,
	modelProviderHeadersPipe,
	modelProviderOptionsPipe,
	modelProviderSourcePipe,
	type ModelProvider,
} from '../domain/model-provider'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	ResourceArchivedError,
	StorageOperationFailedError,
} from '../errors'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, createRecordValue, listRecordsByIds, nextId, secretReferencesFromModelProviderConfig } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import { validateActiveSecretReferencesFromRecords } from '../utils/secrets'
import type { Result as CoreResult } from '../utils/types'

const createModelProviderInputPipe = v.object({
	name: nonEmptyTrimmedStringPipe,
	source: modelProviderSourcePipe,
	auth: v.nullable(modelProviderAuthPipe),
	headers: modelProviderHeadersPipe,
	providerOptions: v.defaults(v.nullable(modelProviderOptionsPipe), null),
})
export type Input = PipeOutput<typeof createModelProviderInputPipe>

export type Result = ModelProvider

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ResourceArchivedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createCreateModelProviderCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createModelProvider', createModelProviderInputPipe, (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		const id = nextId(runtime.values)
		if (!id.ok) return Promise.resolve(id)

		return runtime.transactions.run(async ({ storage }): Promise<CoreResult<ModelProvider, Exclude<Error, InvalidInputError>>> => {
			const secretIds = secretReferencesFromModelProviderConfig(input.auth, input.headers)
			const secrets = await listRecordsByIds('secret', storage, secretIds)
			if (!secrets.ok) return secrets

			const validReferences = validateActiveSecretReferencesFromRecords(secretIds, secrets.value)
			if (!validReferences.ok) return validReferences

			const provider: ModelProvider = {
				id: id.value,
				name: input.name,
				source: input.source,
				auth: input.auth,
				headers: input.headers,
				providerOptions: input.providerOptions,
				created: stamp.value,
				updated: null,
				archivePeriods: [],
			}

			return createRecordValue('model-provider', storage, provider)
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp } = await import('../utils/test-helpers')

	describe('createModelProvider command', () => {
		it('creates Model Providers with normalized config', async () => {
			const options = createTestCoreServices()
			options.tx.secrets.fail.list = true
			const command = createCreateModelProviderCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					name: '  Anthropic  ',
					source: { type: 'custom-hosted', protocol: 'anthropic-messages', baseUrl: ' https://api.example.com ' },
					auth: null,
					headers: [],
					providerOptions: { beta: true },
				},
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000010001',
					name: 'Anthropic',
					source: { type: 'custom-hosted', protocol: 'anthropic-messages', baseUrl: 'https://api.example.com' },
					auth: null,
					headers: [],
					providerOptions: { beta: true },
					created: localStamp(),
					updated: null,
					archivePeriods: [],
				},
			})
		})

		it('rejects a missing Secret reference without creating a Model Provider', async () => {
			const options = createTestCoreServices()
			const command = createCreateModelProviderCommand(createTestCoreRuntime(options))
			const secretId = '01k00000000000000000000040'

			const result = await command(
				{
					name: 'Anthropic',
					source: { type: 'anthropic' },
					auth: { value: { type: 'secret', secretId } },
					headers: [],
					providerOptions: null,
				},
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'secret', id: secretId } })
			expect(options.tx.modelProviders.records.size).toBe(0)
		})
	})
}
