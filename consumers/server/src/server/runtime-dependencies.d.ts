declare module '@vercel/sandbox' {
	export class APIError extends Error {}

	export const Sandbox: {
		getOrCreate(input: Record<string, unknown>): Promise<unknown>
		get(input: Record<string, unknown>): Promise<unknown>
	}
}

declare module 'microsandbox' {
	export const Sandbox: unknown
	export const NetworkPolicy: unknown
	export const Rule: unknown
	export const Destination: unknown
}
