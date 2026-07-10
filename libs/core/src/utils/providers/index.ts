import { createModelProviderProtocolProviders, type ModelProviderProtocolProviders } from './model-provider-protocol'
import { createSourceControlProviders, type SourceControlProviders } from './source-control'
import type { CoreServices } from '../../services'

export interface CoreProviders {
	sourceControl: SourceControlProviders
	modelProviderProtocols: ModelProviderProtocolProviders
}

export function createCoreProviders(services: CoreServices): CoreProviders {
	return {
		sourceControl: createSourceControlProviders(services),
		modelProviderProtocols: createModelProviderProtocolProviders(services),
	}
}
