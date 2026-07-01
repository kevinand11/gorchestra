import { v, type Pipe } from 'valleyed'

import { type AgentRunProviderTool, type CoreAgentRunToolContext } from './types'
import type { AgentRunPurpose, AgentRunToolOutput } from '../../domain/agent-run'
import { planOutputProposalPipe, revisionOutputProposalPipe } from '../../domain/proposals'

export interface CoreAgentRunTool<TInput = unknown> {
	name: string
	description: string
	executionMode: 'parallel-safe' | 'exclusive'
	inputPipe: Pipe<unknown, TInput>
	execute(input: TInput, context: CoreAgentRunToolContext): Promise<AgentRunToolOutput>
}

export function toolsForAgentRunPurpose(purpose: AgentRunPurpose): CoreAgentRunTool[] {
	const toolSets = {
		planning: () => [proposePlanOutputTool()],
		'revision-planning': () => [proposeRevisionOutputTool()],
		execution: () => [],
		'revision-execution': () => [],
	} satisfies Record<AgentRunPurpose['type'], () => CoreAgentRunTool[]>
	return toolSets[purpose.type]()
}

export function providerTool(tool: CoreAgentRunTool): AgentRunProviderTool {
	return { name: tool.name, description: tool.description, executionMode: tool.executionMode, parameters: v.schema(tool.inputPipe) }
}

function proposePlanOutputTool(): CoreAgentRunTool {
	return {
		name: 'propose-plan-output',
		description: 'Record a Plan Output proposal for human review.',
		executionMode: 'exclusive',
		inputPipe: planOutputProposalPipe,
		execute(input, context) {
			return context.recordProposal({ type: 'proposed-plan-output', output: input })
		},
	}
}

function proposeRevisionOutputTool(): CoreAgentRunTool {
	return {
		name: 'propose-revision-output',
		description: 'Record a Revision Output proposal for human review.',
		executionMode: 'exclusive',
		inputPipe: revisionOutputProposalPipe,
		execute(input, context) {
			return context.recordProposal({ type: 'proposed-revision-output', output: input })
		},
	}
}

export function toolOutput(text: string): AgentRunToolOutput {
	return { content: [{ type: 'text', text }], truncation: null }
}

export function validateToolInput(tool: CoreAgentRunTool, input: unknown): { ok: true; value: unknown } | { ok: false } {
	const result = v.validate(tool.inputPipe, input)
	return result.valid ? { ok: true, value: result.value } : { ok: false }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Core Agent Run tools', () => {
		it('exposes provider tool parameters from Valleyed pipes', () => {
			const [tool] = toolsForAgentRunPurpose({ type: 'planning', planId: 'plan-1' })

			expect(providerTool(tool!).parameters).toMatchObject({ type: 'object' })
		})
	})
}
