import { PipeError, v, type Pipe } from 'valleyed'

import type { FormDraftLike, InferFields } from './types'

const nestedFormDraftMetadata = Symbol('gorchestra.formDraft.nested')

type MetadataCarrier = object & { [nestedFormDraftMetadata]?: FormDraftLike }

export function nestedFormDraftPipe<T extends FormDraftLike>(): Pipe<unknown, InferFields<T>> {
	return v.any<InferFields<T>>().pipe((value) => {
		const draft = getNestedFormDraftMetadata(value)
		if (draft === null) return PipeError.root('Expected nested form draft value', value)
		if (!draft.valid) return PipeError.root(draft.firstError, value)
		return value
	})
}

export function attachNestedFormDraftMetadata<T>(value: T, draft: FormDraftLike): T {
	if (!canCarryMetadata(value)) return value
	Object.defineProperty(value, nestedFormDraftMetadata, {
		value: draft,
		enumerable: false,
		configurable: true,
	})
	return value
}

export function copyNestedFormDraftMetadata<T>(source: unknown, target: T): T {
	const draft = getNestedFormDraftMetadata(source)
	return draft === null ? target : attachNestedFormDraftMetadata(target, draft)
}

export function copyNestedFormDraftMetadataTree<T>(source: unknown, target: T): T {
	copyNestedFormDraftMetadata(source, target)
	if (Array.isArray(source) && Array.isArray(target)) {
		source.forEach((sourceItem, index) => {
			copyNestedFormDraftMetadataTree(sourceItem, target[index])
		})
	} else if (isPlainObject(source) && isPlainObject(target)) {
		Object.entries(source).forEach(([key, sourceValue]) => {
			copyNestedFormDraftMetadataTree(sourceValue, target[key])
		})
	}
	return target
}

function getNestedFormDraftMetadata(value: unknown): FormDraftLike | null {
	return canCarryMetadata(value) ? (value[nestedFormDraftMetadata] ?? null) : null
}

function canCarryMetadata(value: unknown): value is MetadataCarrier {
	return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
	return input?.constructor?.name === 'Object'
}
