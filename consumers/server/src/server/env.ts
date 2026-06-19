import { v, type PipeOutput } from 'valleyed'

const serverEnvPipe = v.object({
	GORCHESTRA_WEB_PORT: v.fromJson(v.number()),
	GORCHESTRA_API_PORT: v.fromJson(v.number()),
	GORCHESTRA_API_HOST: v.defaults(v.string().pipe(v.min(1)), '127.0.0.1'),
	GORCHESTRA_DATA_DIR: v.string().pipe(v.min<string>(1)),
	GORCHESTRA_SESSION_JWT_SIGNING_KEY: v.string().pipe(v.min<string>(1)),
	GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY: v.string().pipe(v.min<string>(1)),
})

export type ServerEnv = PipeOutput<typeof serverEnvPipe>

export function readServerEnv(source: Record<string, unknown> = process.env): ServerEnv {
	const result = v.validate(serverEnvPipe, source)
	if (!result.valid) throw new Error(`Environment variables are not valid\n${result.error.toString()}`)
	return result.value
}

export function getApiBaseUrl(env: ServerEnv): string {
	return `http://${env.GORCHESTRA_API_HOST}:${env.GORCHESTRA_API_PORT}`
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	const validEnv = {
		GORCHESTRA_WEB_PORT: '3000',
		GORCHESTRA_API_PORT: '3001',
		GORCHESTRA_DATA_DIR: '/tmp/gorchestra-server',
		GORCHESTRA_SESSION_JWT_SIGNING_KEY: 'session-secret',
		GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY: 'selection-secret',
	}

	describe('Server env', () => {
		it('parses required Server Consumer environment values', () => {
			expect(readServerEnv(validEnv)).toEqual({
				GORCHESTRA_WEB_PORT: 3000,
				GORCHESTRA_API_PORT: 3001,
				GORCHESTRA_API_HOST: '127.0.0.1',
				GORCHESTRA_DATA_DIR: '/tmp/gorchestra-server',
				GORCHESTRA_SESSION_JWT_SIGNING_KEY: 'session-secret',
				GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY: 'selection-secret',
			})
		})

		it('defaults the internal API host to localhost when omitted', () => {
			const env = readServerEnv(validEnv)
			expect(getApiBaseUrl(env)).toBe('http://127.0.0.1:3001')
		})

		it('keeps an explicit internal API host', () => {
			const env = readServerEnv({ ...validEnv, GORCHESTRA_API_HOST: '10.0.0.10' })
			expect(getApiBaseUrl(env)).toBe('http://10.0.0.10:3001')
		})

		it('rejects missing required values', () => {
			expect(() => readServerEnv({ ...validEnv, GORCHESTRA_DATA_DIR: undefined })).toThrow('Environment variables are not valid')
		})
	})
}
