import { v, type PipeOutput } from 'valleyed'

import type { SecretEncryptionKey } from './modules/secret-protection'

export const serverConsumerJsonStorageConfigPipe = v.object({
	type: v.is('json' as const),
	dataDir: v.string().pipe(v.min<string>(1)),
})

export const serverConsumerConfigPipe = v.object({
	http: v.object({ port: v.number() }),
	serverStorage: serverConsumerJsonStorageConfigPipe,
	corePortfolioStorage: serverConsumerJsonStorageConfigPipe,
	cache: serverConsumerJsonStorageConfigPipe,
	security: v.object({
		sessionSigningKey: v.string().pipe(v.min<string>(1)),
		selectionSigningKey: v.string().pipe(v.min<string>(1)),
		secretEncryptionKey: v.instanceOf(Buffer),
	}),
})

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
