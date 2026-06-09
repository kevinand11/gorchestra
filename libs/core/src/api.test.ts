import { describe, expect, it } from 'vitest'

import {
	importSnapshot,
	openCore,
	type CoreSandboxService,
	type CoreSecretsService,
	type CoreStorageService,
	type CoreStorageTransaction,
	type OperationContext,
	type Result,
} from './api'

const context: OperationContext = {
	actor: { type: 'local-user', id: 'actor-1' },
	correlationId: null,
}

const storage: CoreStorageService = {
	preflight: () => Promise.resolve({ ok: true }),
	transaction: <T>(fn: (tx: CoreStorageTransaction) => Promise<T>): Promise<T> => fn({} as CoreStorageTransaction),
}

const secrets: CoreSecretsService = {
	preflight: () => Promise.resolve({ ok: true }),
	resolveSecrets: () => Promise.resolve([]),
	resolveSecretValues: () => Promise.resolve([]),
}

const sandbox: CoreSandboxService = {
	preflight: () => Promise.resolve({ ok: true }),
}

function openCoreOptions() {
	return {
		storage,
		secrets,
		sandbox,
		clock: { now: () => new Date('2026-06-09T00:00:00.000Z') },
		idGenerator: { next: (brand: string) => `${brand}-1` },
	}
}

function openTestCore() {
	return openCore(openCoreOptions())
}

function validCommandInputs(): Record<string, Record<string, unknown>> {
	const id = 'id-1'
	const work = { maxActiveSliceSlots: 1, maxCorrectionRetriesPerFailure: 0, modelTimeoutMs: 1 }
	const projectModel = {
		planningModelId: null,
		revisionPlanningModelId: null,
		executionModelId: null,
		revisionExecutionModelId: null,
	}
	const portfolioConfig = { model: { defaultModelId: id, ...projectModel }, work: null }
	const projectConfig = { model: null, work: null }
	const planConfig = { model: { planningModelId: null } }
	const deliveryConfig = {
		model: { revisionPlanningModelId: null, executionModelId: null, revisionExecutionModelId: null },
		work,
	}
	const planOutput = { proposedDeliveries: [], proposedMemories: [], proposedLinks: [] }
	const revisionOutput = { instruction: { body: '  ' }, disposition: { body: ' handled ' } }
	const repositoryConfig = { provider: 'github', owner: ' octo ', name: ' repo ' }

	return {
		setPortfolioConfig: { config: portfolioConfig },
		createModelProvider: {
			name: ' provider ',
			protocol: 'anthropic-messages',
			baseUrl: 'https://api.example.com/',
			auth: null,
			headers: [],
		},
		updateModelProvider: {
			modelProviderId: id,
			name: 'provider',
			baseUrl: 'http://localhost:3000/',
			auth: { type: 'apiKey', secretId: id },
			headers: [{ name: 'X-API-Key', valueSecretId: id }],
		},
		archiveModelProvider: { modelProviderId: id },
		unarchiveModelProvider: { modelProviderId: id },
		createModel: { providerId: id, name: 'model', providerModelId: ' claude ' },
		updateModel: { modelId: id, name: 'model' },
		archiveModel: { modelId: id },
		unarchiveModel: { modelId: id },
		preflightModel: { modelId: id },
		createPlan: { projectId: id, title: ' title ', config: planConfig },
		acceptPlanOutput: { planId: id, output: planOutput },
		rejectPlanOutput: { planId: id },
		configureDelivery: { deliveryId: id, config: deliveryConfig },
		queueDelivery: { deliveryId: id },
		runDeliveryWork: { deliveryId: id },
		retryDeliveryPreflight: { deliveryId: id },
		openRevisionGate: { reviewSurfaceId: id },
		acceptRevisionOutput: { revisionGateId: id, output: revisionOutput },
		closeRevisionGate: { revisionGateId: id },
		shipDelivery: { deliveryId: id },
		abandonDelivery: { deliveryId: id, reason: '  ' },
		createProject: { title: 'project', source: { type: 'source-control' }, config: projectConfig },
		setProjectConfig: { projectId: id, config: projectConfig },
		createRepository: { projectId: id, config: repositoryConfig },
		updateRepositoryConfig: { repositoryId: id, config: repositoryConfig },
		createSecret: { type: 'generic', name: 'secret', valueRef: ' ref ' },
		replaceSecret: { secretId: id, valueRef: ' ref ' },
		bindSecret: { secretId: id, scope: { type: 'portfolio' }, envName: 'TOKEN' },
		archiveSecretBinding: { secretBindingId: id },
		exportSnapshot: { passphrase: 'passphrase' },
	}
}

describe('core runtime stub', () => {
	it('opens synchronously with valid Core Services', () => {
		const result = openTestCore()

		expect(result).toMatchObject({ ok: true })
		if (result.ok) {
			expect(typeof result.value.preflight).toBe('function')
			expect(typeof result.value.commands.createProject).toBe('function')
			expect(typeof result.value.queries.listProjects).toBe('function')
		}
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
				logger: {
					debug: () => {},
					info: () => {},
					warn: () => {},
					error: () => {},
				},
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
				next: (brand: string) => {
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
			storage: {
				...storage,
				preflight: () => Promise.resolve({ ok: false, message: 'storage is offline' }),
			},
			secrets: {
				...secrets,
				preflight: () => Promise.reject(new Error('raw secret resolver failure')),
			},
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

		const malformedClock = openCore({
			...openCoreOptions(),
			clock: { now: () => new Date('not a date') },
		})
		expect(malformedClock).toMatchObject({ ok: true })
		if (!malformedClock.ok) return
		await expect(malformedClock.value.preflight()).resolves.toMatchObject({
			ok: false,
			error: { type: 'invalid-core-service-output', service: 'clock', operation: 'now' },
		})

		const malformedId = openCore({
			...openCoreOptions(),
			idGenerator: { next: () => '   ' },
		})
		expect(malformedId).toMatchObject({ ok: true })
		if (!malformedId.ok) return
		await expect(malformedId.value.preflight()).resolves.toMatchObject({
			ok: false,
			error: { type: 'invalid-core-service-output', service: 'idGenerator', operation: 'next' },
		})
	})

	it('exposes every documented command and returns not-implemented for valid calls', async () => {
		const result = openTestCore()
		expect(result.ok).toBe(true)
		if (!result.ok) return

		const commands = result.value.commands as unknown as Record<
			string,
			(input: Record<string, unknown>, operationContext: OperationContext) => Promise<Result<unknown>>
		>
		const commandNames = [
			'setPortfolioConfig',
			'createModelProvider',
			'updateModelProvider',
			'archiveModelProvider',
			'unarchiveModelProvider',
			'createModel',
			'updateModel',
			'archiveModel',
			'unarchiveModel',
			'preflightModel',
			'createPlan',
			'acceptPlanOutput',
			'rejectPlanOutput',
			'configureDelivery',
			'queueDelivery',
			'runDeliveryWork',
			'retryDeliveryPreflight',
			'openRevisionGate',
			'acceptRevisionOutput',
			'closeRevisionGate',
			'shipDelivery',
			'abandonDelivery',
			'createProject',
			'setProjectConfig',
			'createRepository',
			'updateRepositoryConfig',
			'createSecret',
			'replaceSecret',
			'bindSecret',
			'archiveSecretBinding',
			'exportSnapshot',
		]

		const inputs = validCommandInputs()

		await Promise.all(
			commandNames.map(async (name) => {
				expect(typeof commands[name]).toBe('function')
				await expect(commands[name]?.(inputs[name] ?? {}, context)).resolves.toEqual({
					ok: false,
					error: { type: 'not-implemented', operation: name },
				})
			}),
		)
	})

	it('exposes every documented query and returns Result not-implemented for valid calls', async () => {
		const result = openTestCore()
		expect(result.ok).toBe(true)
		if (!result.ok) return

		const id = 'id-1' as never
		const reviewScope = { type: 'delivery', deliveryId: id, deliveryArtifactId: id } as never
		const revisionScope = { type: 'delivery-artifact', deliveryId: id, deliveryArtifactId: id } as never
		const queryCalls: Array<[string, () => Promise<Result<unknown>>]> = [
			['getPortfolioConfig', () => result.value.queries.getPortfolioConfig()],
			['getProject', () => result.value.queries.getProject(id)],
			['listProjects', () => result.value.queries.listProjects()],
			['getRepository', () => result.value.queries.getRepository(id)],
			['listRepositories', () => result.value.queries.listRepositories(null)],
			['getModelProvider', () => result.value.queries.getModelProvider(id)],
			['listModelProviders', () => result.value.queries.listModelProviders(null)],
			['getModel', () => result.value.queries.getModel(id)],
			['listModels', () => result.value.queries.listModels(null)],
			['getPlan', () => result.value.queries.getPlan(id)],
			['listPlans', () => result.value.queries.listPlans(null)],
			['getDelivery', () => result.value.queries.getDelivery(id)],
			['listDeliveries', () => result.value.queries.listDeliveries(null)],
			['getSlice', () => result.value.queries.getSlice(id)],
			['listSlices', () => result.value.queries.listSlices(id)],
			['getReviewSurface', () => result.value.queries.getReviewSurface(id)],
			['listReviewSurfaces', () => result.value.queries.listReviewSurfaces(reviewScope)],
			['getCurrentReviewSurface', () => result.value.queries.getCurrentReviewSurface(reviewScope)],
			['getRevision', () => result.value.queries.getRevision(id)],
			['listRevisions', () => result.value.queries.listRevisions(revisionScope)],
			['getTimeline', () => result.value.queries.getTimeline(null)],
		]

		await Promise.all(
			queryCalls.map(async ([name, call]) => {
				await expect(call()).resolves.toEqual({ ok: false, error: { type: 'not-implemented', operation: name } })
			}),
		)
	})

	it('validates command inputs and contexts before returning not-implemented', async () => {
		const result = openTestCore()
		expect(result.ok).toBe(true)
		if (!result.ok) return

		await expect(result.value.commands.queueDelivery({ deliveryId: '   ' } as never, context)).resolves.toMatchObject({
			ok: false,
			error: {
				type: 'invalid-input',
				boundary: 'command',
				operation: 'queueDelivery',
				pipeError: { messages: [expect.objectContaining({ path: 'input.deliveryId' })] },
			},
		})

		await expect(
			result.value.commands.queueDelivery(
				{ deliveryId: 'delivery-1' } as never,
				{
					actor: { type: 123, id: 'actor-1' },
					correlationId: null,
				} as never,
			),
		).resolves.toMatchObject({
			ok: false,
			error: {
				type: 'invalid-input',
				boundary: 'command',
				operation: 'queueDelivery',
				pipeError: { messages: [expect.objectContaining({ path: 'context.actor.type' })] },
			},
		})

		await expect(
			result.value.commands.createSecret({ type: 'generic', name: 'secret', valueRef: '   ' } as never, context),
		).resolves.toMatchObject({
			ok: false,
			error: { type: 'invalid-input', boundary: 'command', operation: 'createSecret' },
		})
	})

	it('validates query arguments before returning not-implemented', async () => {
		const result = openTestCore()
		expect(result.ok).toBe(true)
		if (!result.ok) return

		await expect(result.value.queries.getProject('   ' as never)).resolves.toMatchObject({
			ok: false,
			error: {
				type: 'invalid-input',
				boundary: 'query',
				operation: 'getProject',
				pipeError: { messages: [expect.objectContaining({ path: 'args.0' })] },
			},
		})
	})

	it('accepts unknown object fields at public boundaries rather than rejecting them', async () => {
		const opened = openCore({
			...openCoreOptions(),
			unknown: 'stripped',
		} as never)

		expect(opened).toMatchObject({ ok: true })
		if (!opened.ok) return

		await expect(
			opened.value.commands.queueDelivery(
				{ deliveryId: ' delivery-1 ', unknown: 'stripped' } as never,
				{
					actor: { type: 'local-user', id: 'actor-1', unknown: 'stripped' },
					correlationId: null,
					unknown: 'stripped',
				} as never,
			),
		).resolves.toEqual({ ok: false, error: { type: 'not-implemented', operation: 'queueDelivery' } })

		await expect(opened.value.queries.listRepositories({ projectId: null, unknown: 'stripped' } as never)).resolves.toEqual({
			ok: false,
			error: { type: 'not-implemented', operation: 'listRepositories' },
		})

		await expect(
			importSnapshot(
				{
					passphrase: 'passphrase',
					encryptedPayload: new Uint8Array([1]),
					storage,
					unknown: 'stripped',
				} as never,
				{
					actor: { type: 'local-user', id: 'actor-1', unknown: 'stripped' },
					correlationId: null,
					unknown: 'stripped',
				} as never,
			),
		).resolves.toEqual({ ok: false, error: { type: 'not-implemented', operation: 'importSnapshot' } })
	})

	it('validates snapshot import input and context before returning not-implemented', async () => {
		let storageCalled = false
		const probingStorage: CoreStorageService = {
			preflight: () => {
				storageCalled = true
				return Promise.reject(new Error('storage preflight was probed'))
			},
			transaction: <T>(): Promise<T> => {
				storageCalled = true
				return Promise.reject(new Error('storage transaction was probed'))
			},
		}

		await expect(
			importSnapshot(
				{
					passphrase: '',
					encryptedPayload: new Uint8Array([1]),
					storage: probingStorage,
				},
				context,
			),
		).resolves.toMatchObject({
			ok: false,
			error: { type: 'invalid-input', boundary: 'snapshot-import', operation: 'importSnapshot' },
		})
		expect(storageCalled).toBe(false)

		await expect(
			importSnapshot(
				{
					passphrase: 'passphrase',
					encryptedPayload: new Uint8Array([1]),
					storage: probingStorage,
				},
				{ actor: { type: 123, id: 'actor-1' }, correlationId: null } as never,
			),
		).resolves.toMatchObject({
			ok: false,
			error: {
				type: 'invalid-input',
				boundary: 'snapshot-import',
				operation: 'importSnapshot',
				pipeError: { messages: [expect.objectContaining({ path: 'context.actor.type' })] },
			},
		})
		expect(storageCalled).toBe(false)

		await expect(
			importSnapshot(
				{
					passphrase: 'passphrase',
					encryptedPayload: new Uint8Array([1]),
					storage: probingStorage,
				},
				context,
			),
		).resolves.toEqual({ ok: false, error: { type: 'not-implemented', operation: 'importSnapshot' } })
		expect(storageCalled).toBe(false)
	})
})
