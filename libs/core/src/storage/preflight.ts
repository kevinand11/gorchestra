import type { CorePreflightCheck, CoreStorage } from '../services'
import { projectSchema } from './schemas'
import { withTransaction } from './transactions'

export async function preflightStorage(storage: CoreStorage): Promise<CorePreflightCheck> {
	const probe = await withTransaction({ storage }, async (transactionStorage) => {
		await transactionStorage.on(projectSchema).all().limit(1).find()
		return { ok: true, value: undefined }
	})
	return probe.ok ? { ok: true } : { ok: false, reason: 'probe-failed', message: null }
}
