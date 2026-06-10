/*
 * Gorchestra core API sketch.
 *
 * This barrel exposes the public Core orchestration API while implementation
 * concerns live in focused modules: commands, queries, services, errors,
 * boundary validation, and runtime stubs.
 */

export { importSnapshot, openCore } from './core'
export type * from './boundary-pipes'
export type * from './commands'
export type * from './core'
export type * from './errors'
export type * from './queries'
export type * from './result'
export type * from './services'
