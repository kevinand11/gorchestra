import { normalize } from 'node:path/posix'

import { toolOutput } from './results'
import type { AgentRunToolOutput } from '../../../domain/agent-run'
import type { Result } from '../../../utils/types'

const workspaceRoot = '/workspace'
const gorchestraInternalDirectory = `${workspaceRoot}/.gorchestra`

export function resolveWorkspaceToolPath(
	inputPath: string | undefined,
	options: { defaultPath: string; allowWorkspaceRoot: boolean },
): Result<string, AgentRunToolOutput> {
	const candidate = normalizedCandidate(inputPath, options.defaultPath)
	const absolutePath = candidate.startsWith('/') ? candidate : `${workspaceRoot}/${candidate}`
	const path = normalize(absolutePath)

	if (path !== workspaceRoot && !path.startsWith(`${workspaceRoot}/`)) return invalidPath('Tool paths must stay under /workspace.')
	if (!options.allowWorkspaceRoot && path === workspaceRoot) return invalidPath('Tool path cannot target /workspace directly.')
	if (path === gorchestraInternalDirectory || path.startsWith(`${gorchestraInternalDirectory}/`)) {
		return invalidPath('Tool path is managed by Gorchestra and cannot be accessed.')
	}
	return { ok: true, value: path }
}

function normalizedCandidate(inputPath: string | undefined, defaultPath: string): string {
	const trimmed = inputPath?.trim() ?? ''
	const path = trimmed.length === 0 ? defaultPath : trimmed
	return path.startsWith('@') ? path.slice(1) : path
}

function invalidPath(message: string): Result<never, AgentRunToolOutput> {
	return { ok: false, error: toolOutput(message) }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('resolveWorkspaceToolPath', () => {
		it('normalizes relative, absolute, default, and at-prefixed workspace paths', () => {
			expect(resolveWorkspaceToolPath('src/../README.md', { defaultPath: '/workspace', allowWorkspaceRoot: false })).toEqual({
				ok: true,
				value: '/workspace/README.md',
			})
			expect(resolveWorkspaceToolPath('@/workspace/app/file.ts', { defaultPath: '/workspace', allowWorkspaceRoot: false })).toEqual({
				ok: true,
				value: '/workspace/app/file.ts',
			})
			expect(resolveWorkspaceToolPath(undefined, { defaultPath: '/workspace', allowWorkspaceRoot: true })).toEqual({
				ok: true,
				value: '/workspace',
			})
		})

		it('denies paths outside workspace, protected internals, and root when disallowed', () => {
			expect(resolveWorkspaceToolPath('../secret', { defaultPath: '/workspace', allowWorkspaceRoot: false })).toMatchObject({
				ok: false,
			})
			expect(resolveWorkspaceToolPath('/tmp/file', { defaultPath: '/workspace', allowWorkspaceRoot: false })).toMatchObject({
				ok: false,
			})
			expect(
				resolveWorkspaceToolPath('/workspace/.gorchestra/runtime-env.json', {
					defaultPath: '/workspace',
					allowWorkspaceRoot: false,
				}),
			).toMatchObject({
				ok: false,
			})
			expect(resolveWorkspaceToolPath('/workspace', { defaultPath: '/workspace', allowWorkspaceRoot: false })).toMatchObject({
				ok: false,
			})
		})
	})
}
