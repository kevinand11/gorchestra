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
	ArchivedSecretReferenceError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { auditStamp, createValidModelProvider, nextId, withTransaction } from './utils/storage'

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
	| ArchivedSecretReferenceError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createCreateModelProviderCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createModelProvider', createModelProviderInputPipe, (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		const id = nextId(runtime.values, 'model-provider')
		if (!id.ok) return Promise.resolve(id)

		return withTransaction(runtime.services, (storage): Promise<CoreResult<ModelProvider, Exclude<Error, InvalidInputError>>> => {
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

			return createValidModelProvider(storage, provider)
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp } = await import('../utils/test-helpers')

	describe('createModelProvider command', () => {
		it('creates Model Providers with normalized config', async () => {
			const options = createTestCoreServices()
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
					id: 'model-provider-1',
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
	})
}
