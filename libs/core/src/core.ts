import * as Commands from './commands'
import { createCoreDispatchApi, type CoreDispatchApi } from './dispatch'
import type { CorePreflightError, OpenCoreError } from './errors'
import type { Core as CoreQueries } from './queries'
import { createCoreQueries } from './queries/create-core-queries'
import {
	coreServicePreflightOutputPipe,
	coreServicesPipe,
	type CorePreflightCheck,
	type CorePreflightChecks,
	type CorePreflightReport,
	type CoreServicePreflightOutput,
	type CoreServices,
} from './services'
import { createCoreRuntime } from './utils/runtime'
import * as Snapshots from './utils/snapshots'
import { preflightStorage } from './utils/storage/preflight'
import type { Result } from './utils/types'
import { validateCoreInput, validateCoreServiceOutput } from './validation'

export interface GorchestraCore {
	preflight(): Promise<Result<CorePreflightReport, CorePreflightError>>
	commands: Commands.Core
	queries: CoreQueries
	snapshots: Snapshots.Core
	dispatch: CoreDispatchApi
}

export function openCore(services: CoreServices): Result<GorchestraCore, OpenCoreError> {
	const validation = validateCoreInput(coreServicesPipe, services, 'core', 'openCore')

	if (!validation.ok) return validation

	const runtime = createCoreRuntime(validation.value)

	return {
		ok: true,
		value: {
			preflight: () => preflightCore(runtime),
			commands: Commands.createCoreCommands(runtime),
			queries: createCoreQueries(runtime),
			snapshots: Snapshots.createCoreSnapshots(runtime),
			dispatch: createCoreDispatchApi(runtime),
		},
	}
}

type CorePreflightCheckResult = Result<CorePreflightCheck, CorePreflightError>

async function preflightCore(runtime: ReturnType<typeof createCoreRuntime>): Promise<Result<CorePreflightReport, CorePreflightError>> {
	const checks = await collectCorePreflightChecks(runtime)
	if (!checks.ok) return checks

	return { ok: true, value: corePreflightReport(checks.value) }
}

async function collectCorePreflightChecks(
	runtime: ReturnType<typeof createCoreRuntime>,
): Promise<Result<CorePreflightChecks, CorePreflightError>> {
	const storage = await preflightStorage(runtime.transactions)
	const secrets = await preflightCoreService('secrets', () => runtime.services.secrets.preflight())
	const failure = firstCorePreflightFailure([secrets])
	if (failure !== null) return failure

	return { ok: true, value: { storage, secrets: resultValue(secrets) } }
}

function firstCorePreflightFailure(results: CorePreflightCheckResult[]): Result<never, CorePreflightError> | null {
	const failure = results.find((result) => !result.ok)

	return failure === undefined || failure.ok ? null : { ok: false, error: failure.error }
}

function corePreflightReport(checks: CorePreflightChecks): CorePreflightReport {
	const allChecks = [checks.storage, checks.secrets]

	return { passed: allChecks.every((check) => check.ok), checks }
}

function resultValue<T>(result: Result<T, unknown>): T {
	if (!result.ok) throw new Error('Expected a successful result after checking failures.')

	return result.value
}

async function preflightCoreService(
	service: 'secrets',
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

function preflightCheckFromCoreServiceOutput(output: CoreServicePreflightOutput): CorePreflightCheck {
	return output.ok ? { ok: true } : { ok: false, reason: 'not-ready', message: output.message }
}

function failedProbeCheck(): CorePreflightCheck {
	return { ok: false, reason: 'probe-failed', message: null }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, createTestCoreStorage, noopRawSandboxInstance } = await import('./utils/test-helpers')

	const secrets: CoreServices['secrets'] = {
		preflight: () => Promise.resolve({ ok: true }),
		resolveSecrets: () => Promise.resolve([]),
		resolveSecretValues: () => Promise.resolve({}),
	}

	const sandbox: CoreServices['sandbox'] = {
		kind: 'consumer-managed',
		create: () => Promise.resolve(noopRawSandboxInstance()),
		find: () => Promise.resolve(noopRawSandboxInstance()),
	}
	function coreServices(): CoreServices {
		return { storage: createTestCoreStorage(), secrets, sandbox }
	}

	describe('openCore', () => {
		it('opens synchronously with valid Core Services and composes public runtime namespaces', () => {
			const result = openCore(coreServices())

			expect(result).toMatchObject({ ok: true })
			if (!result.ok) return
			expect(typeof result.value.preflight).toBe('function')
			expect(typeof result.value.commands.createProject).toBe('function')
			expect(typeof result.value.queries.listProjects).toBe('function')
			expect(typeof result.value.snapshots.export).toBe('function')
			expect(typeof result.value.snapshots.restore).toBe('function')
			expect(typeof result.value.dispatch.startProcessor).toBe('function')
			expect('work' in result.value).toBe(false)
		})

		it('rejects invalid core input with a narrow invalid-input error', () => {
			const result = openCore(null as unknown as Parameters<typeof openCore>[0])

			expect(result).toMatchObject({
				ok: false,
				error: {
					type: 'invalid-input',
					boundary: 'core',
					operation: 'openCore',
					pipeError: { messages: [{ message: 'is not an object', value: null }] },
				},
			})
		})

		it('validates Core Service shape without probing service behavior', () => {
			const storage = createTestCoreServices()
			const options = {
				storage: storage.storage,
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
					kind: 'consumer-managed' as const,
					create: () => {
						throw new Error('sandbox create was called')
					},
					find: () => {
						throw new Error('sandbox find was called')
					},
				},
				dispatchWake: {
					publish: () => {
						throw new Error('dispatch wake was published')
					},
					subscribe: () => {
						throw new Error('dispatch wake was subscribed')
					},
				},
			}

			expect(openCore(options)).toMatchObject({ ok: true })
			expect(storage.transactionCalls()).toBe(0)

			const invalidSecrets = { ...options.secrets } as { resolveSecrets?: unknown }
			delete invalidSecrets.resolveSecrets

			expect(openCore({ ...options, secrets: invalidSecrets } as never)).toMatchObject({
				ok: false,
				error: {
					type: 'invalid-input',
					boundary: 'core',
					operation: 'openCore',
					pipeError: { messages: [expect.objectContaining({ path: 'secrets.resolveSecrets' })] },
				},
			})

			const invalidSandbox = { ...options.sandbox } as { create?: unknown }
			delete invalidSandbox.create

			expect(openCore({ ...options, sandbox: invalidSandbox } as never)).toMatchObject({
				ok: false,
				error: {
					type: 'invalid-input',
					boundary: 'core',
					operation: 'openCore',
					pipeError: { messages: [expect.objectContaining({ path: 'sandbox.create' })] },
				},
			})

			const invalidDispatchWake = { ...options.dispatchWake } as { publish?: unknown }
			delete invalidDispatchWake.publish

			expect(openCore({ ...options, dispatchWake: invalidDispatchWake } as never)).toMatchObject({
				ok: false,
				error: {
					type: 'invalid-input',
					boundary: 'core',
					operation: 'openCore',
					pipeError: { messages: [expect.objectContaining({ path: 'dispatchWake.publish' })] },
				},
			})

			expect(openCore({ ...options, storage: { ...options.storage, session: undefined } } as never)).toMatchObject({
				ok: false,
				error: {
					type: 'invalid-input',
					boundary: 'core',
					operation: 'openCore',
					pipeError: { messages: [expect.objectContaining({ path: 'storage' })] },
				},
			})
		})

		it('treats logger, notifications, and Dispatch Wake as optional-only Core Services', () => {
			expect(openCore(coreServices())).toMatchObject({ ok: true })
			expect(
				openCore({
					...coreServices(),
					logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
					notifications: { publish: () => {} },
					dispatchWake: { publish: () => {}, subscribe: () => () => {} },
				}),
			).toMatchObject({ ok: true })
			expect(openCore({ ...coreServices(), logger: null as never })).toMatchObject({
				ok: false,
				error: {
					type: 'invalid-input',
					boundary: 'core',
					operation: 'openCore',
					pipeError: { messages: [expect.objectContaining({ path: 'logger' })] },
				},
			})
			expect(openCore({ ...coreServices(), notifications: null } as unknown as CoreServices)).toMatchObject({
				ok: false,
				error: {
					type: 'invalid-input',
					boundary: 'core',
					operation: 'openCore',
					pipeError: { messages: [expect.objectContaining({ path: 'notifications' })] },
				},
			})
			for (const notifications of [{}, { publish: 'not-a-function' }]) {
				expect(openCore({ ...coreServices(), notifications } as unknown as CoreServices)).toMatchObject({
					ok: false,
					error: {
						type: 'invalid-input',
						boundary: 'core',
						operation: 'openCore',
						pipeError: { messages: [expect.objectContaining({ path: 'notifications.publish' })] },
					},
				})
			}
		})

		it('preflights required Core Services outside commands and queries', async () => {
			const calls: string[] = []
			const opened = openCore({
				storage: createTestCoreStorage(),
				secrets: {
					...secrets,
					preflight: () => {
						calls.push('secrets')
						return Promise.resolve({ ok: true })
					},
				},
				sandbox,
				dispatchWake: {
					publish: () => {
						throw new Error('dispatch wake was checked')
					},
					subscribe: () => {
						throw new Error('dispatch wake was checked')
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
				notifications: {
					publish: () => {
						throw new Error('notifications were checked')
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
					},
				},
			})
			expect(calls).toEqual(['secrets'])
		})

		it('returns failed checks for failed and thrown readiness probes', async () => {
			const opened = openCore({
				...coreServices(),
				secrets: { ...secrets, preflight: () => Promise.reject(new Error('raw secret resolver failure')) },
			})
			expect(opened).toMatchObject({ ok: true })
			if (!opened.ok) return

			await expect(opened.value.preflight()).resolves.toEqual({
				ok: true,
				value: {
					passed: false,
					checks: {
						storage: { ok: true },
						secrets: { ok: false, reason: 'probe-failed', message: null },
					},
				},
			})
		})

		it('returns invalid-core-service-output for malformed readiness outputs', async () => {
			const malformedSecrets = openCore({
				...coreServices(),
				secrets: { ...secrets, preflight: () => Promise.resolve({ ok: 'yes' }) as never },
			})
			expect(malformedSecrets).toMatchObject({ ok: true })
			if (!malformedSecrets.ok) return
			await expect(malformedSecrets.value.preflight()).resolves.toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'secrets', operation: 'preflight' },
			})
		})
	})
}
