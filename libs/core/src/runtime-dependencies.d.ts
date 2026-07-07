declare module '@vercel/sandbox' {
	export class APIError extends Error {}

	export const Sandbox: {
		getOrCreate(input: Record<string, unknown>): Promise<unknown>
		get(input: Record<string, unknown>): Promise<unknown>
	}
}
