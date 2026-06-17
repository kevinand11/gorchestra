import { v, type PipeOutput } from 'valleyed'

import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import { envNamePipe, secretBindingScopePipe, type SecretBinding } from '../domain/secret'
import type {
	ArchivedSecretReferenceError,
	DuplicateSecretBindingError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { buildCommandHandler } from '../utils/command'
import {
	archivedSecretReference,
	auditStamp,
	createRecordValue,
	duplicateSecretBinding,
	getRequired,
	isArchived,
	listRecords,
	nextId,
	scopesEqual,
	withTransaction,
} from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const bindSecretInputPipe = v.object({ secretId: idPipe, scope: secretBindingScopePipe, envName: envNamePipe })
export type Input = PipeOutput<typeof bindSecretInputPipe>

export type Result = SecretBinding

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| DuplicateSecretBindingError
	| ArchivedSecretReferenceError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createBindSecretCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('bindSecret', bindSecretInputPipe, (input, context) => handleBindSecret(runtime, input, context))
}

async function handleBindSecret(runtime: CoreRuntime, input: Input, context: OperationContext): Promise<CoreResult<SecretBinding, Error>> {
	const stamp = auditStamp(runtime.values, context)
	if (!stamp.ok) return stamp

	const id = nextId(runtime.values, 'secret-binding')
	if (!id.ok) return id

	return withTransaction(runtime.services, (storage) => writeSecretBinding(storage, input, stamp.value, id.value))
}

async function writeSecretBinding(
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
	bindingId: Id,
): Promise<CoreResult<SecretBinding, Exclude<Error, InvalidInputError>>> {
	const validation = await validateSecretBindingCreate(storage, input)
	if (!validation.ok) return validation

	const binding: SecretBinding = {
		id: bindingId,
		secretId: input.secretId,
		scope: input.scope,
		envName: input.envName,
		created: stamp,
		archivePeriods: [],
	}
	return createRecordValue('secret-binding', storage, binding)
}

async function validateSecretBindingCreate(
	storage: CoreStorage,
	input: Input,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const secret = await getRequired('secret', storage, input.secretId)
	if (!secret.ok) return secret
	if (isArchived(secret.value.archivePeriods)) return archivedSecretReference(input.secretId)

	return validateSecretBindingUnique(storage, input)
}

async function validateSecretBindingUnique(
	storage: CoreStorage,
	input: Input,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const bindings = await listRecords('secret-binding', storage)
	if (!bindings.ok) return bindings

	const duplicate = bindings.value.find((binding) => binding.envName === input.envName && scopesEqual(binding.scope, input.scope))
	return duplicate === undefined ? { ok: true, value: undefined } : duplicateSecretBinding(duplicate.id, input.scope, input.envName)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSecret } = await import('../utils/test-helpers')

	describe('bindSecret command', () => {
		it('creates Secret Bindings only for existing active Secrets', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, 'secret-1')
			const command = createBindSecretCommand(createTestCoreRuntime(options))

			const result = await command({ secretId: 'secret-1', scope: { type: 'portfolio' }, envName: ' GITHUB_TOKEN ' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'secret-binding-1',
					secretId: 'secret-1',
					scope: { type: 'portfolio' },
					envName: 'GITHUB_TOKEN',
					created: localStamp(),
					archivePeriods: [],
				},
			})
		})
	})
}
