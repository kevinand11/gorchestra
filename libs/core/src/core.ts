import { v, type Pipe } from 'valleyed'

import { importSnapshotBoundaryPipe, operationContextPipe, type ImportSnapshotInput, type OperationContext } from './boundary-pipes'
import {
	commandInputPipes,
	type AcceptPlanOutputResult,
	type AcceptRevisionOutputResult,
	type AbandonDeliveryResult,
	type CoreCommands,
	type OpenRevisionGateResult,
	type QueueDeliveryResult,
	type RetryDeliveryPreflightResult,
	type RunDeliveryWorkResult,
	type ShipDeliveryResult,
} from './commands'
import type {
	CommandStubError,
	CorePreflightError,
	ImportSnapshotError,
	NotImplementedError,
	OpenCoreError,
	WorkStateQueryError,
} from './errors'
import type {
	Delivery,
	DeliveryWorkState,
	Model,
	ModelProvider,
	PortfolioSnapshotManifest,
	Secret,
	SecretBinding,
	SliceWorkState,
	ValidationEvidence,
} from './model'
import { queryArgumentPipes, type CoreQueries } from './queries'
import type { Result } from './result'
import {
	coreClockOutputPipe,
	coreIdOutputPipe,
	coreServicePreflightOutputPipe,
	openCoreOptionsPipe,
	type CorePreflightCheck,
	type CorePreflightReport,
	type CoreServicePreflightOutput,
	type OpenCoreOptions,
} from './services'
import { createStorageBackedCommands } from './storage-backed-commands'
import { validateCoreInput, validateCoreServiceOutput } from './validation'

export interface GorchestraCore {
	preflight(): Promise<Result<CorePreflightReport, CorePreflightError>>
	commands: CoreCommands
	queries: CoreQueries
}

export interface ImportSnapshotResult {
	manifest: PortfolioSnapshotManifest
}

export function openCore(options: OpenCoreOptions): Result<GorchestraCore, OpenCoreError> {
	const validation = validateCoreInput(openCoreOptionsPipe, options, 'construction', 'openCore')

	if (!validation.ok) {
		return validation
	}

	const coreServices = validation.value

	return {
		ok: true,
		value: {
			preflight: () => preflightCore(coreServices),
			commands: createCoreCommands(coreServices),
			queries: createCoreQueries(),
		},
	}
}

/**
 * Import creates a new Portfolio storage boundary, so it is not a command on an
 * already-open GorchestraCore instance.
 */
export async function importSnapshot(
	input: ImportSnapshotInput,
	context: OperationContext,
): Promise<Result<ImportSnapshotResult, ImportSnapshotError>> {
	const validation = validateCoreInput(importSnapshotBoundaryPipe, { input, context }, 'snapshot-import', 'importSnapshot')

	if (!validation.ok) {
		return validation
	}

	return Promise.resolve({ ok: false, error: { type: 'not-implemented', operation: 'importSnapshot' } })
}

async function preflightCore(options: OpenCoreOptions): Promise<Result<CorePreflightReport, CorePreflightError>> {
	const storageCheck = await preflightCoreService('storage', () => options.storage.preflight())
	if (!storageCheck.ok) return storageCheck

	const secretsCheck = await preflightCoreService('secrets', () => options.secrets.preflight())
	if (!secretsCheck.ok) return secretsCheck

	const sandboxCheck = await preflightCoreService('sandbox', () => options.sandbox.preflight())
	if (!sandboxCheck.ok) return sandboxCheck

	const clockCheck = preflightRuntimeService('clock', 'now', () => options.clock.now(), coreClockOutputPipe)
	if (!clockCheck.ok) return clockCheck

	const idGeneratorCheck = preflightRuntimeService(
		'idGenerator',
		'next',
		() => options.idGenerator.next('core-preflight'),
		coreIdOutputPipe,
	)
	if (!idGeneratorCheck.ok) return idGeneratorCheck

	const checks = {
		storage: storageCheck.value,
		secrets: secretsCheck.value,
		sandbox: sandboxCheck.value,
		clock: clockCheck.value,
		idGenerator: idGeneratorCheck.value,
	}

	const passed = [checks.storage, checks.secrets, checks.sandbox, checks.clock, checks.idGenerator].every((check) => check.ok)

	return { ok: true, value: { passed, checks } }
}

async function preflightCoreService(
	service: 'storage' | 'secrets' | 'sandbox',
	probe: () => Promise<CoreServicePreflightOutput>,
): Promise<Result<CorePreflightCheck, CorePreflightError>> {
	try {
		const output = await probe()
		const validation = validateCoreServiceOutput(coreServicePreflightOutputPipe, output, service, 'preflight')

		if (!validation.ok) {
			return validation
		}

		return { ok: true, value: preflightCheckFromCoreServiceOutput(validation.value) }
	} catch {
		return { ok: true, value: failedProbeCheck() }
	}
}

function preflightRuntimeService<TPipe extends Pipe<unknown, unknown>>(
	service: 'clock' | 'idGenerator',
	operation: string,
	probe: () => unknown,
	outputPipe: TPipe,
): Result<CorePreflightCheck, CorePreflightError> {
	try {
		const output = probe()
		const validation = validateCoreServiceOutput(outputPipe, output, service, operation)

		if (!validation.ok) {
			return validation
		}

		return { ok: true, value: { ok: true } }
	} catch {
		return { ok: true, value: failedProbeCheck() }
	}
}

function preflightCheckFromCoreServiceOutput(output: CoreServicePreflightOutput): CorePreflightCheck {
	return output.ok ? { ok: true } : { ok: false, reason: 'not-ready', message: output.message }
}

function failedProbeCheck(): CorePreflightCheck {
	return { ok: false, reason: 'probe-failed', message: null }
}

function createCoreCommands(options: OpenCoreOptions): CoreCommands {
	return {
		...createStorageBackedCommands(options),
		createModelProvider(input, context) {
			return commandStub<ModelProvider>('createModelProvider', input, context)
		},
		updateModelProvider(input, context) {
			return commandStub<ModelProvider>('updateModelProvider', input, context)
		},
		archiveModelProvider(input, context) {
			return commandStub<ModelProvider>('archiveModelProvider', input, context)
		},
		unarchiveModelProvider(input, context) {
			return commandStub<ModelProvider>('unarchiveModelProvider', input, context)
		},
		createModel(input, context) {
			return commandStub<Model>('createModel', input, context)
		},
		updateModel(input, context) {
			return commandStub<Model>('updateModel', input, context)
		},
		archiveModel(input, context) {
			return commandStub<Model>('archiveModel', input, context)
		},
		unarchiveModel(input, context) {
			return commandStub<Model>('unarchiveModel', input, context)
		},
		preflightModel(input, context) {
			return commandStub<ValidationEvidence>('preflightModel', input, context)
		},
		preflightRepository(input, context) {
			return commandStub<ValidationEvidence>('preflightRepository', input, context)
		},
		acceptPlanOutput(input, context) {
			return commandStub<AcceptPlanOutputResult>('acceptPlanOutput', input, context)
		},
		rejectPlanOutput(input, context) {
			return commandStub<void>('rejectPlanOutput', input, context)
		},
		configureDelivery(input, context) {
			return commandStub<Delivery>('configureDelivery', input, context)
		},
		queueDelivery(input, context) {
			return commandStub<QueueDeliveryResult>('queueDelivery', input, context)
		},
		runDeliveryWork(input, context) {
			return commandStub<RunDeliveryWorkResult>('runDeliveryWork', input, context)
		},
		retryDeliveryPreflight(input, context) {
			return commandStub<RetryDeliveryPreflightResult>('retryDeliveryPreflight', input, context)
		},
		openRevisionGate(input, context) {
			return commandStub<OpenRevisionGateResult>('openRevisionGate', input, context)
		},
		acceptRevisionOutput(input, context) {
			return commandStub<AcceptRevisionOutputResult>('acceptRevisionOutput', input, context)
		},
		closeRevisionGate(input, context) {
			return commandStub<void>('closeRevisionGate', input, context)
		},
		shipDelivery(input, context) {
			return commandStub<ShipDeliveryResult>('shipDelivery', input, context)
		},
		abandonDelivery(input, context) {
			return commandStub<AbandonDeliveryResult>('abandonDelivery', input, context)
		},
		createSecret(input, context) {
			return commandStub<Secret>('createSecret', input, context)
		},
		replaceSecret(input, context) {
			return commandStub<Secret>('replaceSecret', input, context)
		},
		bindSecret(input, context) {
			return commandStub<SecretBinding>('bindSecret', input, context)
		},
		archiveSecretBinding(input, context) {
			return commandStub<void>('archiveSecretBinding', input, context)
		},
		exportSnapshot(input, context) {
			return commandStub<PortfolioSnapshotManifest>('exportSnapshot', input, context)
		},
	}
}

function createCoreQueries(): CoreQueries {
	return {
		getDeliveryWorkState: (...args: unknown[]) => queryStub<DeliveryWorkState>('getDeliveryWorkState', args),
		getSliceWorkState: (...args: unknown[]) => queryStub<SliceWorkState>('getSliceWorkState', args),
	}
}

function commandStub<T>(operation: keyof CoreCommands, input: unknown, context: unknown): Promise<Result<T, CommandStubError>> {
	const validation = validateCoreInput(
		v.object({ input: commandInputPipes[operation], context: operationContextPipe }),
		{ input, context },
		'command',
		operation,
	)

	if (!validation.ok) {
		return Promise.resolve(validation)
	}

	return Promise.resolve(notImplemented<T>(operation))
}

function queryStub<T>(operation: keyof CoreQueries, args: unknown[]): Promise<Result<T, WorkStateQueryError>> {
	const validation = validateCoreInput(v.object({ args: queryArgumentPipes[operation] }), { args }, 'query', operation)

	if (!validation.ok) {
		return Promise.resolve(validation)
	}

	return Promise.resolve(notImplemented<T>(operation))
}

function notImplemented<T>(operation: string): Result<T, NotImplementedError> {
	return { ok: false, error: { type: 'not-implemented', operation } }
}
