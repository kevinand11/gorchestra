import { isProxy, isReactive, isRef, reactive, toRaw } from 'vue'

import { copyNestedFormDraftMetadata, copyNestedFormDraftMetadataTree } from './nested'

type InitialValidationResult = { valid: true; value: undefined }
type InvalidValidationResult = { error: { messages: Array<{ message: string }> } }

export function deepToRaw<T>(input: T): T {
	const rawInput = isVueWrapped(input) ? (toRaw(input as object) as T) : input
	if (Array.isArray(rawInput)) return copyNestedFormDraftMetadata(rawInput, deepArrayToRaw(rawInput)) as T
	if (isPlainObject(rawInput)) return copyNestedFormDraftMetadata(rawInput, deepObjectToRaw(rawInput)) as T
	return rawInput
}

function deepArrayToRaw(input: unknown[]): unknown[] {
	return input.map((item) => deepToRaw(item))
}

function deepObjectToRaw(input: Record<string, unknown>): Record<string, unknown> {
	return Object.entries(input).reduce<Record<string, unknown>>((acc, [key, value]) => {
		acc[key] = deepToRaw(value)
		return acc
	}, {})
}

function isVueWrapped(input: unknown): boolean {
	return isRef(input) || isReactive(input) || isProxy(input)
}

export function copy<T>(input: T): T {
	const raw = deepToRaw(input)
	return copyNestedFormDraftMetadataTree(raw, structuredClone(raw))
}

export function makeReactive<T extends object>(input: T): T {
	return reactive(input) as T
}

export function isPlainObject(input: unknown): input is Record<string, unknown> {
	return input?.constructor?.name === 'Object'
}

export function firstErrorMessage(validity: InvalidValidationResult): string {
	return validity.error.messages.at(0)?.message ?? ''
}

export function firstNonEmptyError(errors: Record<string, string>): string {
	return Object.values(errors).find((error) => error.length > 0) ?? ''
}

export function createInitialValidities<Fields extends object>(fields: Fields): Record<keyof Fields, InitialValidationResult> {
	return Object.keys(fields).reduce(
		(acc, key) => ({ ...acc, [key]: { valid: true, value: undefined } }),
		{} as Record<keyof Fields, InitialValidationResult>,
	)
}
