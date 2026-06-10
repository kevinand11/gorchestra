/*
 * Gorchestra core API sketch.
 *
 * This barrel exposes the public Core orchestration API while implementation
 * concerns live in focused modules: commands, queries, snapshots, services,
 * errors, validation, and runtime stubs.
 */

export type * as Commands from './commands'
export type * from './core'
export { openCore } from './core'
export type * as Domain from './domain'
export type * from './errors'
export type * as Queries from './queries'
export type * from './types'
export type * from './services'
export type * as Snapshots from './snapshots'
