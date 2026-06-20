import { pathToFileURL } from 'node:url'

import { Instance } from 'equipped'
import { v, type PipeOutput } from 'valleyed'

import { createServerApiServer } from './api/app'
import { createServerApiContext } from './api/context'
import { readServerEnv } from './env'
import { createDeferredServerConsumerNotFoundHandler, createServerConsumerNotFoundHandler } from './runtime/not-found'
import { createNuxtDevRuntime, type NuxtDevRuntime } from './runtime/nuxt-dev'
import { loadNuxtNodeListener } from './runtime/nuxt-listener'
import { startServerStorage } from './storage/repo'

const serverRuntimeModeEnvPipe = v.object({
	GORCHESTRA_SERVER_MODE: v.optional(v.in(['start', 'dev'] as const)),
})

type ServerRuntimeMode = Exclude<PipeOutput<typeof serverRuntimeModeEnvPipe>['GORCHESTRA_SERVER_MODE'], undefined>

type StartServerConsumerInput = {
	mode?: ServerRuntimeMode
}

type ReadServerRuntimeModeInput = {
	argv?: string[]
	env?: Record<string, unknown>
}

export async function startServerConsumer(input: StartServerConsumerInput = {}): Promise<boolean> {
	const mode = input.mode ?? 'start'
	return mode === 'dev' ? startServerConsumerDev() : startServerConsumerProduction()
}

export function readServerRuntimeMode(input: ReadServerRuntimeModeInput = {}): ServerRuntimeMode {
	return getRuntimeModeFromArgs(input.argv ?? process.argv.slice(2)) ?? getRuntimeModeFromEnv(input.env ?? process.env)
}

function getRuntimeModeFromArgs(argv: string[]): ServerRuntimeMode | null {
	return argv.includes('--dev') ? 'dev' : null
}

function getRuntimeModeFromEnv(env: Record<string, unknown>): ServerRuntimeMode {
	const result = v.validate(serverRuntimeModeEnvPipe, env)
	if (!result.valid) throw new Error(`Server runtime mode is not valid\n${result.error.toString()}`)
	return result.value.GORCHESTRA_SERVER_MODE ?? 'start'
}

async function startServerConsumerProduction(): Promise<boolean> {
	const { server } = await createServerConsumerApiRuntime()
	const nuxtListener = await loadNuxtNodeListener()
	server.setNotFoundHandler(createServerConsumerNotFoundHandler(nuxtListener))
	return server.start()
}

async function startServerConsumerDev(): Promise<boolean> {
	const { server } = await createServerConsumerApiRuntime()
	let nuxtRuntime: NuxtDevRuntime | null = null
	server.setNotFoundHandler(createDeferredServerConsumerNotFoundHandler(() => nuxtRuntime?.listener ?? null))
	server.onBeforeListen(async ({ httpServer, port }) => {
		nuxtRuntime = await createNuxtDevRuntime({ httpServer, port })
		Instance.on('close', async () => await nuxtRuntime?.close())
	})
	return server.start()
}

async function createServerConsumerApiRuntime() {
	const env = readServerEnv()
	const serverStorage = await startServerStorage({ dataDir: env.GORCHESTRA_DATA_DIR })
	const context = createServerApiContext({ serverStorage, env })
	const server = createServerApiServer(context, env)
	return { server }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await startServerConsumer({ mode: readServerRuntimeMode() })
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server runtime mode', () => {
		it('defaults to start mode', () => {
			expect(readServerRuntimeMode({ argv: [], env: {} })).toBe('start')
		})

		it('uses dev mode from the CLI flag', () => {
			expect(readServerRuntimeMode({ argv: ['--dev'], env: {} })).toBe('dev')
		})

		it('uses dev mode from the environment when no CLI flag is present', () => {
			expect(readServerRuntimeMode({ argv: [], env: { GORCHESTRA_SERVER_MODE: 'dev' } })).toBe('dev')
		})

		it('rejects invalid environment runtime mode values', () => {
			expect(() => readServerRuntimeMode({ argv: [], env: { GORCHESTRA_SERVER_MODE: 'invalid' } })).toThrow(
				'Server runtime mode is not valid',
			)
		})
	})
}
