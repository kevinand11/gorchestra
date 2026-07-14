export const defaultDispatchProcessorOptions = {
	maxConcurrentAttempts: 4,
	heartbeatMs: 10_000,
	leaseMs: 60_000,
	idlePollMinMs: 100,
	idlePollMaxMs: 5_000,
	interruptedAttemptLimit: 5,
	completedRetentionMs: 24 * 60 * 60 * 1_000,
	pruneBatchSize: 100,
	shutdownGraceMs: 30_000,
} as const
