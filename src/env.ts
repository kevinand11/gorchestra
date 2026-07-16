import { v } from 'valleyed'

import {
	coreDispatchProcessorConfigPipe,
	parseSecretEncryptionKey,
	portfolioCoreSupervisionConfigPipe,
	type ServerConsumerConfig,
	validateServerConsumerConfig,
} from '@gorchestra/consumer-server'

const gorchestraEnvPipe = v.object({
	GORCHESTRA_PORT: v.fromJson(v.number()),
	GORCHESTRA_DATA_DIR: v.string().pipe(v.min<string>(1)),
	GORCHESTRA_SESSION_JWT_SIGNING_KEY: v.string().pipe(v.min<string>(1)),
	GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY: v.string().pipe(v.min<string>(1)),
	GORCHESTRA_SECRET_ENCRYPTION_KEY: v.string().pipe((value) => parseSecretEncryptionKey(value)),
	GORCHESTRA_PORTFOLIO_CORE_SUPERVISION_CONFIG: v.defaults(v.fromJson(portfolioCoreSupervisionConfigPipe), {}),
	GORCHESTRA_CORE_DISPATCH_PROCESSOR_CONFIG: v.defaults(v.fromJson(coreDispatchProcessorConfigPipe), {}),
})

export function readGorchestraEnv(source: Record<string, unknown>): ServerConsumerConfig {
	const result = v.validate(gorchestraEnvPipe, source)
	if (!result.valid) throw new Error(`Environment variables are not valid\n${result.error.toString()}`)

	const env = result.value
	return validateServerConsumerConfig({
		http: { port: env.GORCHESTRA_PORT },
		serverStorage: { type: 'json', dataDir: env.GORCHESTRA_DATA_DIR },
		corePortfolioStorage: { type: 'json', dataDir: env.GORCHESTRA_DATA_DIR },
		cache: { type: 'json', dataDir: env.GORCHESTRA_DATA_DIR },
		security: {
			sessionSigningKey: env.GORCHESTRA_SESSION_JWT_SIGNING_KEY,
			selectionSigningKey: env.GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY,
			secretEncryptionKey: env.GORCHESTRA_SECRET_ENCRYPTION_KEY,
		},
		portfolioCoreSupervision: env.GORCHESTRA_PORTFOLIO_CORE_SUPERVISION_CONFIG,
		coreDispatchProcessor: env.GORCHESTRA_CORE_DISPATCH_PROCESSOR_CONFIG,
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	const validEnv = {
		GORCHESTRA_PORT: '3000',
		GORCHESTRA_DATA_DIR: '/tmp/gorchestra-server',
		GORCHESTRA_SESSION_JWT_SIGNING_KEY: 'session-secret',
		GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY: 'selection-secret',
		GORCHESTRA_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url'),
	}

	describe('Gorchestra env', () => {
		it('parses Server Consumer config with default Portfolio Core lifecycle values', () => {
			expect(readGorchestraEnv(validEnv)).toEqual({
				http: { port: 3000 },
				serverStorage: { type: 'json', dataDir: '/tmp/gorchestra-server' },
				corePortfolioStorage: { type: 'json', dataDir: '/tmp/gorchestra-server' },
				cache: { type: 'json', dataDir: '/tmp/gorchestra-server' },
				security: {
					sessionSigningKey: 'session-secret',
					selectionSigningKey: 'selection-secret',
					secretEncryptionKey: Buffer.alloc(32, 1),
				},
				portfolioCoreSupervision: {
					reconciliationIntervalMs: 30_000,
					retryInitialDelayMs: 1_000,
					retryMaxDelayMs: 60_000,
					retryMultiplier: 2,
					retryJitterRatio: 0.2,
					runtimeStartTimeoutMs: 60_000,
					shutdownGraceMs: 60_000,
					maxConcurrentStarts: 4,
				},
				coreDispatchProcessor: {
					maxConcurrentAttempts: 4,
					heartbeatMs: 10_000,
					leaseMs: 60_000,
					idlePollMinMs: 100,
					idlePollMaxMs: 5_000,
					interruptedAttemptLimit: 5,
					completedRetentionMs: 86_400_000,
					pruneBatchSize: 100,
					shutdownGraceMs: 30_000,
				},
			})
		})

		it('parses deep-partial Portfolio Core lifecycle JSON overrides', () => {
			const config = readGorchestraEnv({
				...validEnv,
				GORCHESTRA_PORTFOLIO_CORE_SUPERVISION_CONFIG: JSON.stringify({ maxConcurrentStarts: 9 }),
				GORCHESTRA_CORE_DISPATCH_PROCESSOR_CONFIG: JSON.stringify({ idlePollMaxMs: 12_000 }),
			})

			expect(config.portfolioCoreSupervision).toMatchObject({ maxConcurrentStarts: 9, retryInitialDelayMs: 1_000 })
			expect(config.coreDispatchProcessor).toMatchObject({ idlePollMaxMs: 12_000, heartbeatMs: 10_000 })
		})

		it('rejects the removed two-listener port environment shape', () => {
			expect(() =>
				readGorchestraEnv({
					...validEnv,
					GORCHESTRA_PORT: undefined,
					GORCHESTRA_WEB_PORT: '3000',
					GORCHESTRA_API_PORT: '3001',
				}),
			).toThrow('Environment variables are not valid')
		})

		it.each([
			['malformed JSON', { GORCHESTRA_PORTFOLIO_CORE_SUPERVISION_CONFIG: '{' }],
			['invalid lifecycle values', { GORCHESTRA_CORE_DISPATCH_PROCESSOR_CONFIG: '{"heartbeatMs":0}' }],
		])('rejects %s overrides', (_name, overrides) => {
			expect(() => readGorchestraEnv({ ...validEnv, ...overrides })).toThrow('Environment variables are not valid')
		})

		it('rejects missing required values', () => {
			expect(() => readGorchestraEnv({ ...validEnv, GORCHESTRA_DATA_DIR: undefined })).toThrow('Environment variables are not valid')
		})
	})
}
