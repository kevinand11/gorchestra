import type { JsonObject } from '../composables/core/server-api'

export function providerOptionsFromText(value: string): JsonObject | null {
	const trimmed = value.trim()
	return trimmed === '' ? null : (JSON.parse(trimmed) as JsonObject)
}

export function providerOptionsText(value: JsonObject | null): string {
	return value === null ? '' : JSON.stringify(value, null, 2)
}

export function isJsonObjectText(value: string): boolean {
	const trimmed = value.trim()
	if (trimmed === '') return true
	try {
		const parsed: unknown = JSON.parse(trimmed)
		return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
	} catch {
		return false
	}
}
