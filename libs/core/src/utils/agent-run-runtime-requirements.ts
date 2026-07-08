import { v } from 'valleyed'

import { sandboxPathPipe, type AgentRunRuntimeRequirements, type SandboxPath } from '../domain/agent-run-runtime'
import type { InvariantViolationError } from '../errors'
import type { Result } from './types'

export type AgentRunRunCommandRuntimeRequirement = Extract<AgentRunRuntimeRequirements[number], { type: 'run-command' }>

const ensureGitScript = `set -eu

if ! command -v git >/dev/null; then
  if command -v apk >/dev/null; then
    apk add --no-cache git
  elif command -v apt-get >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y git
  elif command -v dnf >/dev/null; then
    dnf install -y git
  elif command -v yum >/dev/null; then
    yum install -y git
  elif command -v microdnf >/dev/null; then
    microdnf install -y git
  else
    echo "Git is not installed and no supported package manager was found. Install git in the Agent Run sandbox image." >&2
    exit 1
  fi
fi

command -v git >/dev/null
`

export const verifyPosixShellRequirement: AgentRunRunCommandRuntimeRequirement = {
	type: 'run-command',
	label: 'Verify POSIX shell is available',
	command: { executable: 'sh', args: ['-c', 'command -v sh >/dev/null'], cwd: '/workspace' },
	root: true,
	commandSecretEnv: {},
}

export const ensureGitRequirement: AgentRunRunCommandRuntimeRequirement = {
	type: 'run-command',
	label: 'Ensure Git is available',
	command: { executable: 'sh', args: ['-c', ensureGitScript], cwd: '/workspace' },
	root: true,
	commandSecretEnv: {},
}

export function sandboxPathFromSegments(segments: string[], joiner: '/' | '-'): Result<SandboxPath, InvariantViolationError> {
	const normalizedSegments = segments.map(normalizeSandboxPathSegment).filter((segment) => segment.length > 0)
	const path = normalizedSegments.length === 0 ? '/workspace' : `/workspace/${normalizedSegments.join(joiner)}`
	const parsed = v.validate(sandboxPathPipe, path)
	return parsed.valid ? { ok: true, value: parsed.value } : invariant('Generated invalid sandbox path.')
}

function normalizeSandboxPathSegment(segment: string): string {
	return segment
		.trim()
		.replaceAll(/[^A-Za-z0-9._-]+/g, '-')
		.replaceAll(/-+/g, '-')
		.replaceAll(/^-|-$/g, '')
}

function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('agent-run-runtime-requirements helpers', () => {
		it('builds explicit Core-authored root command requirements', () => {
			expect(verifyPosixShellRequirement).toMatchObject({
				type: 'run-command',
				label: 'Verify POSIX shell is available',
				root: true,
				command: { executable: 'sh', args: ['-c', 'command -v sh >/dev/null'], cwd: '/workspace' },
			})
			expect(ensureGitRequirement).toMatchObject({ type: 'run-command', label: 'Ensure Git is available', root: true })
			expect(ensureGitRequirement.command.args[1]).toContain('apk add --no-cache git')
			expect(ensureGitRequirement.command.args[1]).toContain('apt-get install -y git')
			expect(ensureGitRequirement.command.args[1]).toContain('command -v git >/dev/null')
		})

		it('builds sandbox paths from normalized segments and explicit joiners', () => {
			expect(sandboxPathFromSegments(['Owner', 'Repo', '01k00000000000000000000034'], '-')).toEqual({
				ok: true,
				value: '/workspace/Owner-Repo-01k00000000000000000000034',
			})
			expect(sandboxPathFromSegments(['repos', 'Repo'], '/')).toEqual({ ok: true, value: '/workspace/repos/Repo' })
			expect(sandboxPathFromSegments([' weird/repo ', 'name💥'], '-')).toEqual({
				ok: true,
				value: '/workspace/weird-repo-name',
			})
			expect(sandboxPathFromSegments(['💥'], '-')).toEqual({ ok: true, value: '/workspace' })
		})
	})
}
