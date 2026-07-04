import { pathToFileURL } from 'node:url'

import { createServerConsumer } from '@gorchestra/consumer-server'

import { readGorchestraEnv } from './env'

export type GorchestraMainInput = {
	argv?: string[]
	env?: Record<string, unknown>
}

export async function main(input: GorchestraMainInput = {}): Promise<void> {
	const argv = input.argv ?? process.argv.slice(2)
	const env = input.env ?? process.env
	const serverConsumer = createServerConsumer(readGorchestraEnv(env))
	await serverConsumer.start({ dev: argv.includes('--dev') })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main()
}
