import { projectSchema } from '../../domain/project'
import type { CorePreflightCheck } from '../../services'
import type { CoreTransactions } from '../transactions'

export async function preflightStorage(transactions: CoreTransactions): Promise<CorePreflightCheck> {
	const probe = await transactions.run(async ({ storage }) => {
		await storage.on(projectSchema).all().limit(1).find()
		return { ok: true, value: undefined }
	})
	return probe.ok ? { ok: true } : { ok: false, reason: 'probe-failed', message: null }
}
