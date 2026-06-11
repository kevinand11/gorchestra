import { createGitHubSourceControlProvider, type GitHubSourceControlProvider } from './github'

export interface SourceControlProviders {
	github: GitHubSourceControlProvider
}

export function createSourceControlProviders(): SourceControlProviders {
	return { github: createGitHubSourceControlProvider() }
}

export type { GitHubSourceControlProvider }
