import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'

export const portfolioSnapshotManifestPipe = v.object({
	id: idPipe,
	snapshotVersion: nonEmptyTrimmedStringPipe,
	exported: auditStampPipe,
	encryptedPayloadRef: nonEmptyTrimmedStringPipe,
})
export type PortfolioSnapshotManifest = PipeOutput<typeof portfolioSnapshotManifestPipe>
