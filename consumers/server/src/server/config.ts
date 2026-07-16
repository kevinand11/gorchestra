import { defaultDispatchProcessorOptions, type CoreDispatchProcessorInput } from '@gorchestra/core'
import { v, type PipeOutput } from 'valleyed'

import type { SecretEncryptionKey } from './modules/secret-protection'

export const defaultPortfolioCoreSupervisionConfig = {
	reconciliationIntervalMs: 30_000,
	retryInitialDelayMs: 1_000,
	retryMaxDelayMs: 60_000,
	retryMultiplier: 2,
	retryJitterRatio: 0.2,
	runtimeStartTimeoutMs: 60_000,
	shutdownGraceMs: 60_000,
	maxConcurrentStarts: 4,
} as const

const coreDispatchProcessorDefaults = defaultDispatchProcessorOptions satisfies Required<CoreDispatchProcessorInput>
const positiveIntegerPipe = v.number().pipe(v.int(), v.gte(1))

export const portfolioCoreSupervisionConfigPipe = v
	.defaults(
		v.object({
			reconciliationIntervalMs: v.defaults(positiveIntegerPipe, defaultPortfolioCoreSupervisionConfig.reconciliationIntervalMs),
			retryInitialDelayMs: v.defaults(positiveIntegerPipe, defaultPortfolioCoreSupervisionConfig.retryInitialDelayMs),
			retryMaxDelayMs: v.defaults(positiveIntegerPipe, defaultPortfolioCoreSupervisionConfig.retryMaxDelayMs),
			retryMultiplier: v.defaults(v.number().pipe(v.gt(1)), defaultPortfolioCoreSupervisionConfig.retryMultiplier),
			retryJitterRatio: v.defaults(v.number().pipe(v.gte(0), v.lte(1)), defaultPortfolioCoreSupervisionConfig.retryJitterRatio),
			runtimeStartTimeoutMs: v.defaults(positiveIntegerPipe, defaultPortfolioCoreSupervisionConfig.runtimeStartTimeoutMs),
			shutdownGraceMs: v.defaults(positiveIntegerPipe, defaultPortfolioCoreSupervisionConfig.shutdownGraceMs),
			maxConcurrentStarts: v.defaults(positiveIntegerPipe, defaultPortfolioCoreSupervisionConfig.maxConcurrentStarts),
		}),
		{},
	)
	.pipe(
		v.custom(
			(config) => config.retryInitialDelayMs <= config.retryMaxDelayMs,
			'Portfolio Core retry initial delay must not exceed its maximum delay.',
		),
	)

export const coreDispatchProcessorConfigPipe = v.defaults(
	v.object({
		maxConcurrentAttempts: v.defaults(positiveIntegerPipe, coreDispatchProcessorDefaults.maxConcurrentAttempts),
		heartbeatMs: v.defaults(positiveIntegerPipe, coreDispatchProcessorDefaults.heartbeatMs),
		leaseMs: v.defaults(positiveIntegerPipe, coreDispatchProcessorDefaults.leaseMs),
		idlePollMinMs: v.defaults(positiveIntegerPipe, coreDispatchProcessorDefaults.idlePollMinMs),
		idlePollMaxMs: v.defaults(positiveIntegerPipe, coreDispatchProcessorDefaults.idlePollMaxMs),
		interruptedAttemptLimit: v.defaults(positiveIntegerPipe, coreDispatchProcessorDefaults.interruptedAttemptLimit),
		completedRetentionMs: v.defaults(positiveIntegerPipe, coreDispatchProcessorDefaults.completedRetentionMs),
		pruneBatchSize: v.defaults(positiveIntegerPipe, coreDispatchProcessorDefaults.pruneBatchSize),
		shutdownGraceMs: v.defaults(positiveIntegerPipe, coreDispatchProcessorDefaults.shutdownGraceMs),
	}),
	{},
)

export const serverConsumerJsonStorageConfigPipe = v.object({
	type: v.is('json' as const),
	dataDir: v.string().pipe(v.min<string>(1)),
})

export const serverConsumerConfigPipe = v
	.object({
		http: v.object({ port: v.number() }),
		serverStorage: serverConsumerJsonStorageConfigPipe,
		corePortfolioStorage: serverConsumerJsonStorageConfigPipe,
		cache: serverConsumerJsonStorageConfigPipe,
		security: v.object({
			sessionSigningKey: v.string().pipe(v.min<string>(1)),
			selectionSigningKey: v.string().pipe(v.min<string>(1)),
			secretEncryptionKey: v.instanceOf(Buffer),
		}),
		portfolioCoreSupervision: portfolioCoreSupervisionConfigPipe,
		coreDispatchProcessor: coreDispatchProcessorConfigPipe,
	})
	.pipe(
		v.custom(
			(config) => config.portfolioCoreSupervision.shutdownGraceMs >= config.coreDispatchProcessor.shutdownGraceMs,
			'Portfolio Core supervision shutdown grace must cover the Dispatch Processor shutdown grace.',
		),
	)

export type PortfolioCoreSupervisionConfig = PipeOutput<typeof portfolioCoreSupervisionConfigPipe>
export type ServerConsumerCoreDispatchProcessorConfig = PipeOutput<typeof coreDispatchProcessorConfigPipe>
export type ServerConsumerJsonStorageConfig = PipeOutput<typeof serverConsumerJsonStorageConfigPipe>
export type ServerConsumerServerStorageConfig = ServerConsumerJsonStorageConfig
export type ServerConsumerCorePortfolioStorageConfig = ServerConsumerJsonStorageConfig
export type ServerConsumerCacheConfig = ServerConsumerJsonStorageConfig
export type ServerConsumerConfig = Omit<PipeOutput<typeof serverConsumerConfigPipe>, 'security'> & {
	security: Omit<PipeOutput<typeof serverConsumerConfigPipe>['security'], 'secretEncryptionKey'> & {
		secretEncryptionKey: SecretEncryptionKey
	}
}

export function validateServerConsumerConfig(input: ServerConsumerConfig): ServerConsumerConfig {
	const result = v.validate(serverConsumerConfigPipe, input)
	if (!result.valid) throw new Error(`Server Consumer Config is not valid\n${result.error.toString()}`)
	return result.value
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server Consumer config', () => {
		const baseConfig = {
			http: { port: 3000 },
			serverStorage: { type: 'json' as const, dataDir: '/tmp/gorchestra' },
			corePortfolioStorage: { type: 'json' as const, dataDir: '/tmp/gorchestra' },
			cache: { type: 'json' as const, dataDir: '/tmp/gorchestra' },
			security: {
				sessionSigningKey: 'session-key',
				selectionSigningKey: 'selection-key',
				secretEncryptionKey: Buffer.alloc(32, 1),
			},
		}

		it('materializes Portfolio Core lifecycle defaults when groups are omitted', () => {
			const config = validateServerConsumerConfig(baseConfig as ServerConsumerConfig)

			expect(config).toMatchObject({
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

		it('fills omitted fields in deep-partial lifecycle groups', () => {
			const config = validateServerConsumerConfig({
				...baseConfig,
				portfolioCoreSupervision: { maxConcurrentStarts: 7 },
				coreDispatchProcessor: { idlePollMaxMs: 9_000 },
			} as ServerConsumerConfig)

			expect(config.portfolioCoreSupervision).toEqual({
				...defaultPortfolioCoreSupervisionConfig,
				maxConcurrentStarts: 7,
			})
			expect(config.coreDispatchProcessor).toEqual({
				...defaultDispatchProcessorOptions,
				idlePollMaxMs: 9_000,
			})
		})

		it('rejects a non-positive runtime start capacity', () => {
			expect(() =>
				validateServerConsumerConfig({
					...baseConfig,
					portfolioCoreSupervision: { maxConcurrentStarts: 0 },
				} as ServerConsumerConfig),
			).toThrow('Server Consumer Config is not valid')
		})

		it.each([
			['zero supervision timing', { portfolioCoreSupervision: { runtimeStartTimeoutMs: 0 } }],
			['negative processor timing', { coreDispatchProcessor: { heartbeatMs: -1 } }],
			['fractional processor capacity', { coreDispatchProcessor: { maxConcurrentAttempts: 1.5 } }],
		])('rejects %s', (_name, invalidGroup) => {
			expect(() => validateServerConsumerConfig({ ...baseConfig, ...invalidGroup } as ServerConsumerConfig)).toThrow(
				'Server Consumer Config is not valid',
			)
		})

		it('rejects a retry initial delay greater than its cap', () => {
			expect(() =>
				validateServerConsumerConfig({
					...baseConfig,
					portfolioCoreSupervision: { retryInitialDelayMs: 10_000, retryMaxDelayMs: 5_000 },
				} as ServerConsumerConfig),
			).toThrow('Server Consumer Config is not valid')
		})

		it.each([
			['a retry multiplier that does not increase', { retryMultiplier: 1 }],
			['negative retry jitter', { retryJitterRatio: -0.1 }],
			['retry jitter above one', { retryJitterRatio: 1.1 }],
		])('rejects %s', (_name, invalidSupervision) => {
			expect(() =>
				validateServerConsumerConfig({
					...baseConfig,
					portfolioCoreSupervision: invalidSupervision,
				} as ServerConsumerConfig),
			).toThrow('Server Consumer Config is not valid')
		})

		it('rejects a supervision shutdown grace shorter than the processor grace', () => {
			expect(() =>
				validateServerConsumerConfig({
					...baseConfig,
					portfolioCoreSupervision: { shutdownGraceMs: 5_000 },
					coreDispatchProcessor: { shutdownGraceMs: 10_000 },
				} as ServerConsumerConfig),
			).toThrow('Server Consumer Config is not valid')
		})
	})
}
