import type { CoreAgentRunToolDefinition } from './registry'
import { planOutputProposalPipe } from '../../../../domain/proposals'

export function proposePlanOutputTool(): CoreAgentRunToolDefinition {
	return {
		name: 'propose-plan-output',
		contractVersion: 1,
		description: 'Record a Plan Output proposal for human review.',
		inputPipe: planOutputProposalPipe,
		promptSnippet: 'Use propose-plan-output when you are ready to submit a complete Plan Output for human review.',
		promptGuidelines: [
			'Call this tool only when the proposed Plan Output is internally consistent and ready for review.',
			'Do not use this tool for partial drafts or status updates.',
		],
		workspaceMutationKind: 'read-only',
		execute(input, context) {
			return context.recordProposal({ type: 'proposed-plan-output', output: input })
		},
	}
}
