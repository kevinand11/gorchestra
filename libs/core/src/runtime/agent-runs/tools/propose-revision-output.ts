import type { CoreAgentRunToolDefinition } from './registry'
import { revisionOutputProposalPipe } from '../../../domain/proposals'

export function proposeRevisionOutputTool(): CoreAgentRunToolDefinition {
	return {
		name: 'propose-revision-output',
		contractVersion: 1,
		description: 'Record a Revision Output proposal for human review.',
		inputPipe: revisionOutputProposalPipe,
		promptSnippet: 'Use propose-revision-output when you are ready to submit a complete Revision Output for human review.',
		promptGuidelines: [
			'Call this tool only when the proposed Revision Output is internally consistent and ready for review.',
			'Do not use this tool for partial drafts or status updates.',
		],
		workspaceMutationKind: 'read-only',
		execute(input, context) {
			return context.recordProposal({ type: 'proposed-revision-output', output: input })
		},
	}
}
