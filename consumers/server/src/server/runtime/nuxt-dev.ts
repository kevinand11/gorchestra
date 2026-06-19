import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { toNodeListener } from 'h3'
import { buildNuxt, loadNuxt, writeTypes } from 'nuxt/kit'

import type { NuxtNodeListener } from './nuxt-listener'

export type NuxtDevRuntime = {
	listener: NuxtNodeListener
	close: () => Promise<void>
}

type CreateNuxtDevRuntimeInput = {
	httpServer: HttpServer
	port: number
	cwd?: string
}

type NuxtLike = Awaited<ReturnType<typeof loadNuxt>>

type NuxtDevServerLike = {
	handler?: unknown
	app?: unknown
	upgrade?: unknown
}

type NodeUpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void

const defaultNuxtRootDir = fileURLToPath(new URL('../../..', import.meta.url))

export async function createNuxtDevRuntime(input: CreateNuxtDevRuntimeInput): Promise<NuxtDevRuntime> {
	const nuxt = await loadNuxt({
		cwd: input.cwd ?? defaultNuxtRootDir,
		dev: true,
		ready: false,
		overrides: {
			devServer: {
				host: '0.0.0.0',
				port: input.port,
				url: `http://localhost:${input.port}/`,
			},
		},
	})

	nuxt.hooks.hook('vite:extend', ({ config }) => {
		config.server ??= {}
		const hmr = typeof config.server.hmr === 'object' && config.server.hmr !== null ? config.server.hmr : {}
		const nextHmr = { ...hmr, server: input.httpServer }
		delete (nextHmr as { host?: unknown }).host
		delete (nextHmr as { port?: unknown }).port
		config.server.hmr = nextHmr
	})

	await nuxt.ready()
	nuxt.options.devServer.host = '0.0.0.0'
	nuxt.options.devServer.port = input.port
	nuxt.options.devServer.url = `http://localhost:${input.port}/`
	await writeTypes(nuxt)
	await buildNuxt(nuxt)

	const listener = resolveNuxtDevNodeListener(nuxt.server)
	const upgradeHandler = createNuxtDevUpgradeHandler(nuxt)
	if (upgradeHandler) input.httpServer.on('upgrade', upgradeHandler)

	return {
		listener,
		close: async () => {
			if (upgradeHandler) input.httpServer.off('upgrade', upgradeHandler)
			await nuxt.close()
		},
	}
}

function resolveNuxtDevNodeListener(server: unknown): NuxtNodeListener {
	const devServer = server as NuxtDevServerLike | undefined
	return getDirectNuxtDevNodeListener(devServer) ?? getH3NuxtDevNodeListener(devServer)
}

function getDirectNuxtDevNodeListener(devServer: NuxtDevServerLike | undefined): NuxtNodeListener | null {
	return typeof devServer?.handler === 'function' ? (devServer.handler as NuxtNodeListener) : null
}

function getH3NuxtDevNodeListener(devServer: NuxtDevServerLike | undefined): NuxtNodeListener {
	if (!devServer?.app) throw new Error('Nuxt dev server does not expose a Node listener')
	return toNodeListener(devServer.app as Parameters<typeof toNodeListener>[0])
}

function createNuxtDevUpgradeHandler(nuxt: NuxtLike): NodeUpgradeHandler | null {
	const upgrade = (nuxt.server as NuxtDevServerLike | undefined)?.upgrade
	if (typeof upgrade !== 'function') return null
	const handleUpgrade = upgrade as NodeUpgradeHandler
	const viteHmrPath = joinUrlPath(nuxt.options.app.baseURL, nuxt.options.app.buildAssetsDir)
	return (request, socket, head) => {
		if (!shouldDelegateNuxtUpgrade(request.url ?? '/', viteHmrPath)) return
		handleUpgrade(request, socket, head)
	}
}

function shouldDelegateNuxtUpgrade(rawUrl: string, viteHmrPath: string): boolean {
	const pathname = getUrlPathname(rawUrl)
	return !isViteHmrPath(pathname, viteHmrPath) && !isSocketIoPath(pathname)
}

function getUrlPathname(rawUrl: string): string {
	return rawUrl.split('?')[0] ?? rawUrl
}

function isViteHmrPath(pathname: string, viteHmrPath: string): boolean {
	return pathname.startsWith(viteHmrPath)
}

function isSocketIoPath(pathname: string): boolean {
	return pathname === '/socket.io' || pathname.startsWith('/socket.io/')
}

function joinUrlPath(...parts: string[]): string {
	const joined = parts
		.flatMap((part) => part.split('/'))
		.filter(Boolean)
		.join('/')
	return `/${joined}${parts.at(-1)?.endsWith('/') ? '/' : ''}`
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Nuxt dev runtime helpers', () => {
		it('uses a direct Nuxt dev server handler when available', async () => {
			const handler: NuxtNodeListener = () => 'handled'
			const listener = resolveNuxtDevNodeListener({ handler })

			expect(await listener({} as IncomingMessage, {} as ServerResponse)).toBe('handled')
		})

		it('converts a Nuxt H3 app into a Node listener when no direct handler is available', () => {
			const app = { handler: () => undefined, options: {} }
			const listener = resolveNuxtDevNodeListener({ app })

			expect(listener).toBeTypeOf('function')
		})

		it('rejects a Nuxt dev server without a usable listener', () => {
			expect(() => resolveNuxtDevNodeListener({})).toThrow('Nuxt dev server does not expose a Node listener')
		})

		it.each([
			['/_nuxt/', false],
			['/_nuxt/?token=abc', false],
			['/_nuxt/app.js', false],
			['/socket.io/', false],
			['/socket.io/?transport=websocket', false],
			['/custom-socket', true],
		])('returns %s upgrade delegation as %s', (path, expected) => {
			expect(shouldDelegateNuxtUpgrade(path, '/_nuxt/')).toBe(expected)
		})
	})
}
