import { v, type PipeOutput } from 'valleyed'

import { parseSecretEncryptionKey } from './modules/secret-protection'

const serverEnvPipe = v.object({
	GORCHESTRA_PORT: v.fromJson(v.number()),
	GORCHESTRA_DATA_DIR: v.string().pipe(v.min<string>(1)),
	GORCHESTRA_SESSION_JWT_SIGNING_KEY: v.string().pipe(v.min<string>(1)),
	GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY: v.string().pipe(v.min<string>(1)),
	GORCHESTRA_SECRET_ENCRYPTION_KEY: v.string().pipe((val) => parseSecretEncryptionKey(val)),
})

export type ServerEnv = PipeOutput<typeof serverEnvPipe>

export function readServerEnv(source: Record<string, unknown> = process.env): ServerEnv {
	const result = v.validate(serverEnvPipe, source)
	if (!result.valid) throw new Error(`Environment variables are not valid\n${result.error.toString()}`)
	return result.value
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

	describe('Server env', () => {
		it('parses required Server Consumer environment values', () => {
			expect(readServerEnv(validEnv)).toEqual({
				GORCHESTRA_PORT: 3000,
				GORCHESTRA_DATA_DIR: '/tmp/gorchestra-server',
				GORCHESTRA_SESSION_JWT_SIGNING_KEY: 'session-secret',
				GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY: 'selection-secret',
				GORCHESTRA_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url'),
			})
		})

		it('rejects the removed two-listener port environment shape', () => {
			expect(() =>
				readServerEnv({
					...validEnv,
					GORCHESTRA_PORT: undefined,
					GORCHESTRA_WEB_PORT: '3000',
					GORCHESTRA_API_PORT: '3001',
				}),
			).toThrow('Environment variables are not valid')
		})

		it('rejects missing required values', () => {
			expect(() => readServerEnv({ ...validEnv, GORCHESTRA_DATA_DIR: undefined })).toThrow('Environment variables are not valid')
		})
	})
}
