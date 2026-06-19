import type { ServerEnv } from '../env'
import type { ServerStorage } from '../storage/repo'

export type ServerApiClock = () => Date

export type ServerApiContext = {
	serverStorage: ServerStorage
	dataDir: string
	sessionSigningKey: string
	selectionSigningKey: string
	now: ServerApiClock
}

export type CreateServerApiContextInput = {
	serverStorage: ServerStorage
	env: ServerEnv
	now?: ServerApiClock
}

export function createServerApiContext(input: CreateServerApiContextInput): ServerApiContext {
	return {
		serverStorage: input.serverStorage,
		dataDir: input.env.GORCHESTRA_DATA_DIR,
		sessionSigningKey: input.env.GORCHESTRA_SESSION_JWT_SIGNING_KEY,
		selectionSigningKey: input.env.GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY,
		now: input.now ?? (() => new Date()),
	}
}
