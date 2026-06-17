import type { CorePreflightCheck } from '../services'
import type { CoreStorage } from '../services'
import { portfolioConfigSchema, portfolioConfigStorageId } from './schemas'

export async function preflightStorage(storage: CoreStorage): Promise<CorePreflightCheck> {
	try {
		await storage.session(async () => {
			await storage.on(portfolioConfigSchema).one().id(portfolioConfigStorageId).find()
		})
		return { ok: true }
	} catch {
		return { ok: false, reason: 'probe-failed', message: null }
	}
}
