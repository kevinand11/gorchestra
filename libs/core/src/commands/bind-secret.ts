import { v, type PipeOutput } from 'valleyed'

import {
	archivedSecretReference,
	auditStamp,
	duplicateSecretBinding,
	getRequired,
	isArchived,
	listRecords,
	nextId,
	putRecord,
	scopesEqual,
	withTransaction,
} from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import { envNamePipe, secretBindingScopePipe, type SecretBinding } from '../domain/secret'
import { secretBindingPipe, secretPipe } from '../domain/secret'
import type {
	ArchivedSecretReferenceError,
	DuplicateSecretBindingError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorageTransaction, OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../utils/types'

const bindSecretInputPipe = v.object({ secretId: idPipe, scope: secretBindingScopePipe, envName: envNamePipe })
export type Input = PipeOutput<typeof bindSecretInputPipe>

export type Result = SecretBinding

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| DuplicateSecretBindingError
	| ArchivedSecretReferenceError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createBindSecretCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('bindSecret', bindSecretInputPipe, (input, context) => handleBindSecret(options, input, context))
}

async function handleBindSecret(
	options: OpenCoreOptions,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<SecretBinding, Error>> {
	const stamp = auditStamp(options, context)
	if (!stamp.ok) return stamp

	const id = nextId(options, 'secret-binding')
	if (!id.ok) return id

	return withTransaction(options, (tx) => writeSecretBinding(tx, input, stamp.value, id.value))
}

async function writeSecretBinding(
	tx: CoreStorageTransaction,
	input: Input,
	stamp: AuditStamp,
	bindingId: Id,
): Promise<CoreResult<SecretBinding, Exclude<Error, InvalidInputError>>> {
	const validation = await validateSecretBindingCreate(tx, input)
	if (!validation.ok) return validation

	const binding: SecretBinding = {
		id: bindingId,
		secretId: input.secretId,
		scope: input.scope,
		envName: input.envName,
		created: stamp,
		archivePeriods: [],
	}
	const stored = await putRecord('secret-binding', tx.secretBindings, binding.id, binding)
	if (!stored.ok) return stored

	return { ok: true, value: binding }
}

async function validateSecretBindingCreate(
	tx: CoreStorageTransaction,
	input: Input,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const secret = await getRequired('secret', tx.secrets, input.secretId, secretPipe)
	if (!secret.ok) return secret
	if (isArchived(secret.value.archivePeriods)) return archivedSecretReference(input.secretId)

	return validateSecretBindingUnique(tx, input)
}

async function validateSecretBindingUnique(
	tx: CoreStorageTransaction,
	input: Input,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const bindings = await listRecords('secret-binding', tx.secretBindings, secretBindingPipe)
	if (!bindings.ok) return bindings

	const duplicate = bindings.value.find((binding) => binding.envName === input.envName && scopesEqual(binding.scope, input.scope))
	return duplicate === undefined ? { ok: true, value: undefined } : duplicateSecretBinding(duplicate.id, input.scope, input.envName)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSecret } = await import('./test-utils')

	describe('bindSecret command', () => {
		it('creates Secret Bindings only for existing active Secrets', async () => {
			const options = createTestOpenCoreOptions()
			seedSecret(options.tx, 'secret-1')
			const command = createBindSecretCommand(options)

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
