import type { SandboxReadFileOutput } from '../../../../services'
import type { CoreAgentRunToolContext } from '../types'
import { failInvalidInput, failSandboxError, sandboxErrorSummary } from './results'

export async function readRequiredWorkspaceFile(
	context: CoreAgentRunToolContext,
	path: string,
	action: 'read' | 'edit',
): Promise<Extract<NonNullable<SandboxReadFileOutput>, { type: 'file' }>> {
	const file = await context.sandbox.readFile({ path })
	if (!file.ok) failSandboxError(sandboxErrorSummary(file.error))
	if (file.value === null) failInvalidInput(`Path not found: ${path}.`)
	if (file.value.type === 'directory') failInvalidInput(directoryMessage(action, path))
	if (file.value.type === 'other') failInvalidInput(`Cannot ${action} non-file path: ${path}.`)
	return file.value
}

function directoryMessage(action: 'read' | 'edit', path: string): string {
	return action === 'read' ? `Cannot read directory as a file: ${path}. Use ls instead.` : `Cannot edit directory as a file: ${path}.`
}
