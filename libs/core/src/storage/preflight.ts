import type { CorePreflightCheck, CoreStorage } from '../services'
import { portfolioConfigSchema, portfolioConfigStorageId } from './schemas'
import { withTransaction } from './transactions'

export async function preflightStorage(storage: CoreStorage): Promise<CorePreflightCheck> {
	const probe = await withTransaction({ storage }, async (transactionStorage) => {
		await transactionStorage.on(portfolioConfigSchema).one().id(portfolioConfigStorageId).find()
		return { ok: true, value: undefined }
	})
	return probe.ok ? { ok: true } : { ok: false, reason: 'probe-failed', message: null }
}
