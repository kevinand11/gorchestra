import { createModelProviderProtocolProviders, type ModelProviderProtocolProviders } from './model-provider-protocol'
import { createSourceControlProviders, type SourceControlProviders } from './source-control'

export interface CoreProviders {
	sourceControl: SourceControlProviders
	modelProviderProtocols: ModelProviderProtocolProviders
}

export function createCoreProviders(): CoreProviders {
	return {
		sourceControl: createSourceControlProviders(),
		modelProviderProtocols: createModelProviderProtocolProviders(),
	}
}
