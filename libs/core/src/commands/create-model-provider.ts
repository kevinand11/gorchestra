import { v, type PipeOutput } from 'valleyed'

import { nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import {
	modelProviderAuthPipe,
	modelProviderBaseUrlPipe,
	modelProviderHeadersPipe,
	modelProviderProtocolPipe,
	type ModelProvider,
} from '../domain/model-provider'
import type {
	ArchivedSecretReferenceError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import { buildCommandHandler } from '../utils/command'
import { auditStamp, nextId, putValidModelProvider, withTransaction } from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const createModelProviderInputPipe = v.object({
	name: nonEmptyTrimmedStringPipe,
	protocol: modelProviderProtocolPipe,
	baseUrl: modelProviderBaseUrlPipe,
	auth: v.nullable(modelProviderAuthPipe),
	headers: modelProviderHeadersPipe,
})
export type Input = PipeOutput<typeof createModelProviderInputPipe>

export type Result = ModelProvider

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ArchivedSecretReferenceError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCreateModelProviderCommand(runtime: CoreRuntime): Operation {
	const options = runtime.services
	return buildCommandHandler('createModelProvider', createModelProviderInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		const id = nextId(options, 'model-provider')
		if (!id.ok) return Promise.resolve(id)

		return withTransaction(options, (tx): Promise<CoreResult<ModelProvider, Exclude<Error, InvalidInputError>>> => {
			const provider: ModelProvider = {
				id: id.value,
				name: input.name,
				protocol: input.protocol,
				baseUrl: input.baseUrl,
				auth: input.auth,
				headers: input.headers,
				created: stamp.value,
				updated: null,
				archivePeriods: [],
			}

			return putValidModelProvider(tx, provider)
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
				{ name: '  Anthropic  ', protocol: 'anthropic-messages', baseUrl: ' https://api.example.com ', auth: null, headers: [] },
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'model-provider-1',
					name: 'Anthropic',
					protocol: 'anthropic-messages',
					baseUrl: 'https://api.example.com',
					auth: null,
					headers: [],
					created: localStamp(),
					updated: null,
					archivePeriods: [],
				},
			})
		})
	})
}
