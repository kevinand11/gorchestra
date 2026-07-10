import { withTransaction } from './transactions'
import { projectSchema } from '../../domain/project'
import type { CorePreflightCheck, CoreStorage } from '../../services'

export async function preflightStorage(storage: CoreStorage): Promise<CorePreflightCheck> {
	const probe = await withTransaction({ storage }, async (transactionStorage) => {
		await transactionStorage.on(projectSchema).all().limit(1).find()
		return { ok: true, value: undefined }
	})
	return probe.ok ? { ok: true } : { ok: false, reason: 'probe-failed', message: null }
}
