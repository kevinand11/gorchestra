import { v } from 'valleyed'

import { parseSecretEncryptionKey, type ServerConsumerConfig } from '@gorchestra/consumer-server'

const gorchestraEnvPipe = v.object({
	GORCHESTRA_PORT: v.fromJson(v.number()),
	GORCHESTRA_DATA_DIR: v.string().pipe(v.min<string>(1)),
	GORCHESTRA_SESSION_JWT_SIGNING_KEY: v.string().pipe(v.min<string>(1)),
	GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY: v.string().pipe(v.min<string>(1)),
	GORCHESTRA_SECRET_ENCRYPTION_KEY: v.string().pipe((value) => parseSecretEncryptionKey(value)),
})

export function readGorchestraEnv(source: Record<string, unknown>): ServerConsumerConfig {
	const result = v.validate(gorchestraEnvPipe, source)
	if (!result.valid) throw new Error(`Environment variables are not valid\n${result.error.toString()}`)

	const env = result.value
	return {
		http: { port: env.GORCHESTRA_PORT },
		serverStorage: { type: 'json', dataDir: env.GORCHESTRA_DATA_DIR },
		corePortfolioStorage: { type: 'json', dataDir: env.GORCHESTRA_DATA_DIR },
		cache: { type: 'json', dataDir: env.GORCHESTRA_DATA_DIR },
		security: {
			sessionSigningKey: env.GORCHESTRA_SESSION_JWT_SIGNING_KEY,
			selectionSigningKey: env.GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY,
			secretEncryptionKey: env.GORCHESTRA_SECRET_ENCRYPTION_KEY,
		},
	}
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
		it('parses Server Consumer config from root environment values', () => {
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
			})
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

		it('rejects missing required values', () => {
			expect(() => readGorchestraEnv({ ...validEnv, GORCHESTRA_DATA_DIR: undefined })).toThrow('Environment variables are not valid')
		})
	})
}
