import type { JSONValue } from 'ai'
import { differ } from 'valleyed'

import type { Model } from '../../domain/model'
import type { ModelProvider, ModelProviderOptions } from '../../domain/model-provider'

export type WrappedProviderOptions = Record<string, Record<string, JSONValue>>

type ProviderOptionsOwner = Pick<ModelProvider | Model, 'providerOptions'>

export function resolveProviderOptions(
	namespace: string,
	defaults: ModelProviderOptions | null,
	modelProvider: ProviderOptionsOwner,
	model: ProviderOptionsOwner,
): WrappedProviderOptions | undefined {
	const providerMerged: ModelProviderOptions = differ.merge(defaults ?? {}, modelProvider.providerOptions ?? {}) as ModelProviderOptions
	const merged = differ.merge(providerMerged, model.providerOptions ?? {}) as Record<string, JSONValue>
	return Object.keys(merged).length === 0 ? undefined : { [namespace]: merged }
}
