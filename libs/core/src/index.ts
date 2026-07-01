/*
 * Gorchestra core API sketch.
 *
 * This barrel exposes the public Core orchestration API while implementation
 * concerns live in focused modules: commands, queries, snapshots, services,
 * errors, validation, and runtime stubs.
 */

export type * as Commands from './commands'
export type * as Work from './work'
export type * from './core'
export { openCore } from './core'
export * as Domain from './domain'
export type * from './errors'
export * as Queries from './queries'
export type * from './utils/types'
export type * from './services'
export { coreStorageMigrations } from './storage/migrations'
export type * as Snapshots from './snapshots'
