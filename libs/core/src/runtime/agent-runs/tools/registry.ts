import { v, type Pipe } from 'valleyed'

import { editTool } from './edit'
import { findTool } from './find'
import { grepTool } from './grep'
import { lsTool } from './ls'
import { proposePlanOutputTool } from './propose-plan-output'
import { proposeRevisionOutputTool } from './propose-revision-output'
import { readTool } from './read'
import { toolOutput } from './results'
import { shTool } from './sh'
import { writeTool } from './write'
import { agentRunToolSetPipe, type AgentRunToolOutput, type AgentRunToolSet } from '../../../domain/agent-run'
import type { InvariantViolationError } from '../../../errors'
import type { Result } from '../../../utils/types'
import type { AgentRunProviderTool, CoreAgentRunToolContext } from '../types'

export type WorkspaceMutationKind = 'read-only' | 'file-mutator' | 'global-mutator'

export interface CoreAgentRunToolDefinition<TInput = unknown> {
	name: string
	contractVersion: number
	description: string
	inputPipe: Pipe<unknown, TInput>
	promptSnippet: string
	promptGuidelines: string[]
	workspaceMutationKind: WorkspaceMutationKind
	workspaceMutationKey?(input: TInput): Result<string, AgentRunToolOutput>
	execute(input: TInput, context: CoreAgentRunToolContext): Promise<AgentRunToolOutput>
}

export const readOnlyWorkspaceToolNames = Object.freeze(['read', 'grep', 'find', 'ls'] as const)
export const writeCapableWorkspaceToolNames = Object.freeze([...readOnlyWorkspaceToolNames, 'sh', 'edit', 'write'] as const)

const registeredToolDefinitions = Object.freeze([
	readTool(),
	grepTool(),
	findTool(),
	lsTool(),
	shTool(),
	editTool(),
	writeTool(),
	proposePlanOutputTool(),
	proposeRevisionOutputTool(),
] as const)

export function agentRunToolSetFromNames(names: readonly string[]): Result<AgentRunToolSet, InvariantViolationError> {
	const parsed = v.validate(
		agentRunToolSetPipe,
		names.map((name) => ({ name, contractVersion: 1 })),
	)
	return parsed.valid ? { ok: true, value: parsed.value } : invariant('Resolved Agent Run Tool Set is invalid.')
}

export function resolveToolSet(toolSet: AgentRunToolSet): Result<CoreAgentRunToolDefinition[], InvariantViolationError> {
	const definitions: CoreAgentRunToolDefinition[] = []
	for (const entry of toolSet) {
		const definition = definitionForEntry(entry)
		if (definition === null) return invariant(`Unsupported Agent Run Tool ${entry.name}@${entry.contractVersion}.`)
		definitions.push(definition)
	}
	return { ok: true, value: definitions }
}

export function providerTool(tool: CoreAgentRunToolDefinition): AgentRunProviderTool {
	return { name: tool.name, description: tool.description, parameters: v.schema(tool.inputPipe) }
}

export { toolOutput }

export function validateToolInput(tool: CoreAgentRunToolDefinition, input: unknown): { ok: true; value: unknown } | { ok: false } {
	const result = v.validate(tool.inputPipe, input)
	return result.valid ? { ok: true, value: result.value } : { ok: false }
}

function definitionForEntry(entry: AgentRunToolSet[number]): CoreAgentRunToolDefinition | null {
	const definition = registeredToolDefinitions.find((candidate) => candidate.name === entry.name)
	return definition?.contractVersion === entry.contractVersion ? definition : null
}

function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Core Agent Run tool registry', () => {
		it('defines ordered workspace tool name sets', () => {
			expect(readOnlyWorkspaceToolNames).toEqual(['read', 'grep', 'find', 'ls'])
			expect(writeCapableWorkspaceToolNames).toEqual(['read', 'grep', 'find', 'ls', 'sh', 'edit', 'write'])
		})

		it('attaches initial contract versions when building Tool Set snapshots', () => {
			expect(agentRunToolSetFromNames(['read', 'propose-plan-output'])).toEqual({
				ok: true,
				value: [
					{ name: 'read', contractVersion: 1 },
					{ name: 'propose-plan-output', contractVersion: 1 },
				],
			})
		})

		it('rejects duplicate Tool Set names', () => {
			expect(agentRunToolSetFromNames(['read', 'read'])).toMatchObject({
				ok: false,
				error: { type: 'invariant-violation' },
			})
		})

		it('resolves supported built-in and proposal tools and rejects unsupported entries', () => {
			expect(
				resolveToolSet([
					{ name: 'read', contractVersion: 1 },
					{ name: 'grep', contractVersion: 1 },
					{ name: 'find', contractVersion: 1 },
					{ name: 'ls', contractVersion: 1 },
					{ name: 'sh', contractVersion: 1 },
					{ name: 'edit', contractVersion: 1 },
					{ name: 'write', contractVersion: 1 },
					{ name: 'propose-plan-output', contractVersion: 1 },
				]),
			).toMatchObject({
				ok: true,
				value: [
					{ name: 'read', contractVersion: 1, workspaceMutationKind: 'read-only' },
					{ name: 'grep', contractVersion: 1, workspaceMutationKind: 'read-only' },
					{ name: 'find', contractVersion: 1, workspaceMutationKind: 'read-only' },
					{ name: 'ls', contractVersion: 1, workspaceMutationKind: 'read-only' },
					{ name: 'sh', contractVersion: 1, workspaceMutationKind: 'global-mutator' },
					{ name: 'edit', contractVersion: 1, workspaceMutationKind: 'file-mutator' },
					{ name: 'write', contractVersion: 1, workspaceMutationKind: 'file-mutator' },
					{ name: 'propose-plan-output', contractVersion: 1, workspaceMutationKind: 'read-only' },
				],
			})
			expect(resolveToolSet([{ name: 'propose-plan-output', contractVersion: 2 }])).toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Unsupported Agent Run Tool propose-plan-output@2.' },
			})
			expect(resolveToolSet([{ name: 'unknown-tool', contractVersion: 1 }])).toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Unsupported Agent Run Tool unknown-tool@1.' },
			})
		})

		it('exposes provider tool parameters from Valleyed pipes', () => {
			const resolved = resolveToolSet([{ name: 'propose-plan-output', contractVersion: 1 }])
			expect(resolved.ok && providerTool(resolved.value[0]!).parameters).toMatchObject({ type: 'object' })
		})
	})
}
