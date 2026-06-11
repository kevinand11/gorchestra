import { type Pipe } from 'valleyed'

import * as Commands from './commands'
import type { CorePreflightError, OpenCoreError } from './errors'
import * as Queries from './queries'
import {
	coreClockOutputPipe,
	coreIdOutputPipe,
	coreServicePreflightOutputPipe,
	openCoreOptionsPipe,
	type CorePreflightCheck,
	type CorePreflightChecks,
	type CorePreflightReport,
	type CoreServicePreflightOutput,
	type OpenCoreOptions,
} from './services'
import * as Snapshots from './snapshots'
import type { Result } from './utils/types'
import { validateCoreInput, validateCoreServiceOutput } from './validation'

export interface GorchestraCore {
	preflight(): Promise<Result<CorePreflightReport, CorePreflightError>>
	commands: Commands.Core
	queries: Queries.Core
	snapshots: Snapshots.Core
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
			commands: Commands.createCoreCommands(coreServices),
			queries: Queries.createCoreQueries(coreServices),
			snapshots: Snapshots.createCoreSnapshots(),
		},
	}
}

type CorePreflightCheckResult = Result<CorePreflightCheck, CorePreflightError>

async function preflightCore(options: OpenCoreOptions): Promise<Result<CorePreflightReport, CorePreflightError>> {
	const checks = await collectCorePreflightChecks(options)
	if (!checks.ok) return checks

	return { ok: true, value: corePreflightReport(checks.value) }
}

async function collectCorePreflightChecks(options: OpenCoreOptions): Promise<Result<CorePreflightChecks, CorePreflightError>> {
	const storage = await preflightCoreService('storage', () => options.storage.preflight())
	const secrets = await preflightCoreService('secrets', () => options.secrets.preflight())
	const sandbox = await preflightCoreService('sandbox', () => options.sandbox.preflight())
	const clock = preflightRuntimeService('clock', 'now', () => options.clock.now(), coreClockOutputPipe)
	const idGenerator = preflightRuntimeService('idGenerator', 'next', () => options.idGenerator.next('core-preflight'), coreIdOutputPipe)
	const failure = firstCorePreflightFailure([storage, secrets, sandbox, clock, idGenerator])
	if (failure !== null) return failure

	return {
		ok: true,
		value: {
			storage: resultValue(storage),
			secrets: resultValue(secrets),
			sandbox: resultValue(sandbox),
			clock: resultValue(clock),
			idGenerator: resultValue(idGenerator),
		},
	}
}

function firstCorePreflightFailure(results: CorePreflightCheckResult[]): Result<never, CorePreflightError> | null {
	const failure = results.find((result) => !result.ok)

	return failure === undefined || failure.ok ? null : { ok: false, error: failure.error }
}

function corePreflightReport(checks: CorePreflightChecks): CorePreflightReport {
	const allChecks = [checks.storage, checks.secrets, checks.sandbox, checks.clock, checks.idGenerator]

	return { passed: allChecks.every((check) => check.ok), checks }
}

function resultValue<T>(result: Result<T, unknown>): T {
	if (!result.ok) throw new Error('Expected a successful result after checking failures.')

	return result.value
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

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	const storage: OpenCoreOptions['storage'] = {
		preflight: () => Promise.resolve({ ok: true }),
		transaction: (fn) => fn({} as never),
	}

	const secrets: OpenCoreOptions['secrets'] = {
		preflight: () => Promise.resolve({ ok: true }),
		resolveSecrets: () => Promise.resolve([]),
		resolveSecretValues: () => Promise.resolve([]),
	}

	const sandbox: OpenCoreOptions['sandbox'] = { preflight: () => Promise.resolve({ ok: true }) }

	function openCoreOptions(): OpenCoreOptions {
		return {
			storage,
			secrets,
			sandbox,
			clock: { now: () => new Date('2026-06-09T00:00:00.000Z') },
			idGenerator: { next: (brand) => `${brand}-1` },
		}
	}

	describe('openCore', () => {
		it('opens synchronously with valid Core Services and composes public runtime namespaces', () => {
			const result = openCore(openCoreOptions())

			expect(result).toMatchObject({ ok: true })
			if (!result.ok) return
			expect(typeof result.value.preflight).toBe('function')
			expect(typeof result.value.commands.createProject).toBe('function')
			expect(typeof result.value.queries.getDeliveryWorkState).toBe('function')
			expect(typeof result.value.snapshots.export).toBe('function')
			expect(typeof result.value.snapshots.restore).toBe('function')
		})

		it('rejects invalid construction input with a narrow invalid-input error', () => {
			const result = openCore(null as unknown as Parameters<typeof openCore>[0])

			expect(result).toMatchObject({
				ok: false,
				error: {
					type: 'invalid-input',
					boundary: 'construction',
					operation: 'openCore',
					pipeError: { messages: [{ message: 'is not an object', value: null }] },
				},
			})
		})

		it('validates Core Service shape without probing service behavior', () => {
			const options = {
				storage: {
					preflight: () => {
						throw new Error('storage preflight was probed')
					},
					transaction: () => {
						throw new Error('storage transaction was probed')
					},
				},
				secrets: {
					preflight: () => {
						throw new Error('secret preflight was probed')
					},
					resolveSecrets: () => {
						throw new Error('secret resolution was probed')
					},
					resolveSecretValues: () => {
						throw new Error('secret value resolution was probed')
					},
				},
				sandbox: {
					preflight: () => {
						throw new Error('sandbox preflight was probed')
					},
				},
				clock: {
					now: () => {
						throw new Error('clock was probed')
					},
				},
				idGenerator: {
					next: () => {
						throw new Error('id generator was probed')
					},
				},
			}

			expect(openCore(options)).toMatchObject({ ok: true })

			const invalidSecrets = { ...options.secrets } as { resolveSecrets?: unknown }
			delete invalidSecrets.resolveSecrets

			expect(openCore({ ...options, secrets: invalidSecrets as never })).toMatchObject({
				ok: false,
				error: {
					type: 'invalid-input',
					boundary: 'construction',
					operation: 'openCore',
					pipeError: { messages: [expect.objectContaining({ path: 'secrets.resolveSecrets' })] },
				},
			})

			expect(openCore({ ...options, idGenerator: {} as never })).toMatchObject({
				ok: false,
				error: {
					type: 'invalid-input',
					boundary: 'construction',
					operation: 'openCore',
					pipeError: { messages: [expect.objectContaining({ path: 'idGenerator.next' })] },
				},
			})
		})

		it('treats logger and event sink as optional-only Core Services', () => {
			expect(openCore(openCoreOptions())).toMatchObject({ ok: true })
			expect(
				openCore({
					...openCoreOptions(),
					logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
					eventSink: { publish: () => {} },
				}),
			).toMatchObject({ ok: true })
			expect(openCore({ ...openCoreOptions(), logger: null as never })).toMatchObject({
				ok: false,
				error: {
					type: 'invalid-input',
					boundary: 'construction',
					operation: 'openCore',
					pipeError: { messages: [expect.objectContaining({ path: 'logger' })] },
				},
			})
			expect(openCore({ ...openCoreOptions(), eventSink: null as never })).toMatchObject({
				ok: false,
				error: {
					type: 'invalid-input',
					boundary: 'construction',
					operation: 'openCore',
					pipeError: { messages: [expect.objectContaining({ path: 'eventSink' })] },
				},
			})
		})

		it('preflights required Core Services and runtime dependencies outside commands and queries', async () => {
			const calls: string[] = []
			const opened = openCore({
				storage: {
					...storage,
					preflight: () => {
						calls.push('storage')
						return Promise.resolve({ ok: true })
					},
				},
				secrets: {
					...secrets,
					preflight: () => {
						calls.push('secrets')
						return Promise.resolve({ ok: true })
					},
				},
				sandbox: {
					preflight: () => {
						calls.push('sandbox')
						return Promise.resolve({ ok: true })
					},
				},
				clock: {
					now: () => {
						calls.push('clock')
						return new Date('2026-06-09T00:00:00.000Z')
					},
				},
				idGenerator: {
					next: (brand) => {
						calls.push(`idGenerator:${brand}`)
						return `${brand}-1`
					},
				},
				logger: {
					debug: () => {
						throw new Error('logger was checked')
					},
					info: () => {
						throw new Error('logger was checked')
					},
					warn: () => {
						throw new Error('logger was checked')
					},
					error: () => {
						throw new Error('logger was checked')
					},
				},
				eventSink: {
					publish: () => {
						throw new Error('event sink was checked')
					},
				},
			})
			expect(opened).toMatchObject({ ok: true })
			if (!opened.ok) return

			expect((opened.value.commands as unknown as Record<string, unknown>)['preflight']).toBeUndefined()
			expect((opened.value.queries as unknown as Record<string, unknown>)['preflight']).toBeUndefined()
			await expect(opened.value.preflight()).resolves.toEqual({
				ok: true,
				value: {
					passed: true,
					checks: {
						storage: { ok: true },
						secrets: { ok: true },
						sandbox: { ok: true },
						clock: { ok: true },
						idGenerator: { ok: true },
					},
				},
			})
			expect(calls).toEqual(['storage', 'secrets', 'sandbox', 'clock', 'idGenerator:core-preflight'])
		})

		it('returns failed checks for failed and thrown readiness probes', async () => {
			const opened = openCore({
				...openCoreOptions(),
				storage: { ...storage, preflight: () => Promise.resolve({ ok: false, message: 'storage is offline' }) },
				secrets: { ...secrets, preflight: () => Promise.reject(new Error('raw secret resolver failure')) },
				clock: {
					now: () => {
						throw new Error('raw clock failure')
					},
				},
				idGenerator: {
					next: () => {
						throw new Error('raw id generator failure')
					},
				},
			})
			expect(opened).toMatchObject({ ok: true })
			if (!opened.ok) return

			await expect(opened.value.preflight()).resolves.toEqual({
				ok: true,
				value: {
					passed: false,
					checks: {
						storage: { ok: false, reason: 'not-ready', message: 'storage is offline' },
						secrets: { ok: false, reason: 'probe-failed', message: null },
						sandbox: { ok: true },
						clock: { ok: false, reason: 'probe-failed', message: null },
						idGenerator: { ok: false, reason: 'probe-failed', message: null },
					},
				},
			})
		})

		it('returns invalid-core-service-output for malformed readiness outputs', async () => {
			const malformedStorage = openCore({
				...openCoreOptions(),
				storage: { ...storage, preflight: () => Promise.resolve({ ok: 'yes' }) as never },
			})
			expect(malformedStorage).toMatchObject({ ok: true })
			if (!malformedStorage.ok) return
			await expect(malformedStorage.value.preflight()).resolves.toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'storage', operation: 'preflight' },
			})

			const malformedClock = openCore({ ...openCoreOptions(), clock: { now: () => new Date('not a date') } })
			expect(malformedClock).toMatchObject({ ok: true })
			if (!malformedClock.ok) return
			await expect(malformedClock.value.preflight()).resolves.toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'clock', operation: 'now' },
			})

			const malformedId = openCore({ ...openCoreOptions(), idGenerator: { next: () => '   ' } })
			expect(malformedId).toMatchObject({ ok: true })
			if (!malformedId.ok) return
			await expect(malformedId.value.preflight()).resolves.toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'idGenerator', operation: 'next' },
			})
		})
	})
}
