import type { ServerCache } from '../cache'
import type { ServerEnv } from '../env'
import { parseSecretEncryptionKey, type SecretEncryptionKey } from '../modules/secret-protection'
import type { ServerStorage } from '../storage/repo'

export type ServerApiClock = () => Date

export type ServerApiContext = {
	serverStorage: ServerStorage
	serverCache: ServerCache
	dataDir: string
	sessionSigningKey: string
	selectionSigningKey: string
	secretEncryptionKey: SecretEncryptionKey
	now: ServerApiClock
}

export type CreateServerApiContextInput = {
	serverStorage: ServerStorage
	serverCache: ServerCache
	env: ServerEnv
	now?: ServerApiClock
}

export function createServerApiContext(input: CreateServerApiContextInput): ServerApiContext {
	return {
		serverStorage: input.serverStorage,
		serverCache: input.serverCache,
		dataDir: input.env.GORCHESTRA_DATA_DIR,
		sessionSigningKey: input.env.GORCHESTRA_SESSION_JWT_SIGNING_KEY,
		selectionSigningKey: input.env.GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY,
		secretEncryptionKey: parseSecretEncryptionKey(input.env.GORCHESTRA_SECRET_ENCRYPTION_KEY),
		now: input.now ?? (() => new Date()),
	}
}
