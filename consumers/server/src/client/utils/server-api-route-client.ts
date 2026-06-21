import type { AxiosRequestConfig } from 'axios'
import type {
	DefaultBody,
	DefaultCookies,
	DefaultHeaders,
	DefaultParams,
	DefaultQuery,
	RouteContract,
	RouteContractOf,
	RouteInput,
	RouteOutput,
} from 'equipped/server'

import type { createServerApiServer } from '../../server/api/app'

type ServerRouteContract = RouteContractOf<ReturnType<typeof createServerApiServer>>

type AxiosRouteTransport = {
	request<T = unknown>(config: AxiosRequestConfig): Promise<{ data: T; status: number }>
}

type RouteMethod<Contract extends RouteContract> = keyof Contract & string
type RoutePath<Contract extends RouteContract, Method extends RouteMethod<Contract>> = keyof Contract[Method] & string
type RouteBody<Contract extends RouteContract, Method extends RouteMethod<Contract>, Path extends RoutePath<Contract, Method>> =
	RouteOutput<Contract, Method, Path> extends { body: infer Body } ? Body : never

type IsExactly<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
			? true
			: false
		: false

type IsUnknown<T> = unknown extends T ? ([keyof T] extends [never] ? true : false) : false

type EmptyRouteInput = Record<never, never>
type OptionalWhenDefault<Name extends string, Value, Default> =
	IsExactly<Value, Default> extends true ? { [Key in Name]?: Value } : { [Key in Name]: Value }

type BodyInput<Input> = 'body' extends keyof Input
	? IsUnknown<Input['body']> extends true
		? { body?: DefaultBody }
		: { body: Input['body'] }
	: EmptyRouteInput

type ParamsInput<Input> = 'params' extends keyof Input ? OptionalWhenDefault<'params', Input['params'], DefaultParams> : EmptyRouteInput
type QueryInput<Input> = 'query' extends keyof Input ? OptionalWhenDefault<'query', Input['query'], DefaultQuery> : EmptyRouteInput
type HeadersInput<Input> = 'headers' extends keyof Input
	? OptionalWhenDefault<'headers', Input['headers'], DefaultHeaders>
	: EmptyRouteInput

type ClientRouteInput<
	Contract extends RouteContract,
	Method extends RouteMethod<Contract>,
	Path extends RoutePath<Contract, Method>,
> = BodyInput<RouteInput<Contract, Method, Path>> &
	ParamsInput<RouteInput<Contract, Method, Path>> &
	QueryInput<RouteInput<Contract, Method, Path>> &
	HeadersInput<RouteInput<Contract, Method, Path>>

type ClientRouteInputArgs<Contract extends RouteContract, Method extends RouteMethod<Contract>, Path extends RoutePath<Contract, Method>> =
	EmptyRouteInput extends ClientRouteInput<Contract, Method, Path>
		? [input?: ClientRouteInput<Contract, Method, Path>]
		: [input: ClientRouteInput<Contract, Method, Path>]

const apiPathPrefix = '/api'
const noContentStatusCode = 204
const routeParamPrimitiveTypes = new Set(['string', 'number', 'boolean', 'bigint'])

export function createRouteContractAxiosClient<Contract extends RouteContract = ServerRouteContract>(client: AxiosRouteTransport) {
	return {
		async request<Method extends RouteMethod<Contract>, Path extends RoutePath<Contract, Method>>(
			method: Method,
			path: Path,
			...args: ClientRouteInputArgs<Contract, Method, Path>
		): Promise<RouteBody<Contract, Method, Path>> {
			const input = args[0]
			const config: AxiosRequestConfig = {
				method,
				url: applyPathParams(toAxiosPath(path), getInputPart(input, 'params')),
			}
			const query = getInputPart(input, 'query')
			if (query !== undefined) config.params = query
			const body = getInputPart(input, 'body')
			if (body !== undefined) config.data = body
			const headers = getInputPart(input, 'headers')
			if (headers !== undefined) config.headers = headers as AxiosRequestConfig['headers']

			return getResponseBody(await client.request<RouteBody<Contract, Method, Path>>(config))
		},
	}
}

function toAxiosPath(path: string): string {
	if (path === apiPathPrefix) return '/'
	if (!path.startsWith(`${apiPathPrefix}/`)) throw new Error(`Server API contract path must start with ${apiPathPrefix}: ${path}`)
	return path.slice(apiPathPrefix.length)
}

function applyPathParams(path: string, params: unknown): string {
	return path.replace(/:([A-Za-z0-9_]+)/g, (_segment, key: string) => {
		if (!isRecord(params) || params[key] === undefined || params[key] === null)
			throw new Error(`Missing route param "${key}" for ${path}`)
		return encodeURIComponent(routeParamToString(params[key], key, path))
	})
}

function routeParamToString(value: unknown, key: string, path: string): string {
	if (!isRouteParamPrimitive(value)) throw new Error(`Route param "${key}" for ${path} must be a string, number, boolean, or bigint`)
	return String(value)
}

function isRouteParamPrimitive(value: unknown): value is string | number | boolean | bigint {
	return routeParamPrimitiveTypes.has(typeof value)
}

function getInputPart(input: unknown, key: string): unknown {
	if (!isRecord(input) || !(key in input)) return undefined
	return input[key]
}

function getResponseBody<T>(response: { data: T; status: number }): T {
	return response.status === noContentStatusCode ? (undefined as T) : response.data
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === 'object' && input !== null
}

if (import.meta.vitest) {
	const { describe, expect, expectTypeOf, it } = import.meta.vitest
	type ExampleRouteContract = {
		post: {
			'/api/projects/:projectId': {
				input: {
					params: { projectId: string }
					query: { includeRepositories?: boolean }
					headers: { 'x-request-id'?: string }
					cookies: { gorchestra_session?: string }
					body: { title: string }
				}
				output: {
					body: { id: string }
					headers: Record<never, never>
					cookies: Record<never, never>
					statusCode: 200
					contentType: 'application/json'
				}
			}
		}
		delete: {
			'/api/projects/:projectId': {
				input: { params: { projectId: string }; query: DefaultQuery; headers: DefaultHeaders; cookies: DefaultCookies }
				output: {
					body: undefined
					headers: Record<never, never>
					cookies: Record<never, never>
					statusCode: 204
					contentType: 'application/json'
				}
			}
		}
	}

	describe('Route Contract Axios client', () => {
		it('strips the API path prefix used by the contract path', () => {
			expect(toAxiosPath('/api')).toBe('/')
			expect(toAxiosPath('/api/auth/session')).toBe('/auth/session')
			expect(() => toAxiosPath('/auth/session')).toThrow('Server API contract path must start with /api')
		})

		it('interpolates and encodes path params', () => {
			expect(
				applyPathParams('/projects/:projectId/repositories/:repositoryId', { projectId: 'Project A', repositoryId: 'r/1' }),
			).toBe('/projects/Project%20A/repositories/r%2F1')
			expect(() => applyPathParams('/projects/:projectId', {})).toThrow('Missing route param "projectId"')
		})

		it('maps Route Contract input to Axios request config', async () => {
			const requests: AxiosRequestConfig[] = []
			const routeClient = createRouteContractAxiosClient<ExampleRouteContract>({
				request<T>(config: AxiosRequestConfig) {
					requests.push(config)
					return Promise.resolve({ data: { id: 'project-1' } as T, status: 200 })
				},
			})

			const result = await routeClient.request('post', '/api/projects/:projectId', {
				params: { projectId: 'Project A' },
				query: { includeRepositories: true },
				headers: { 'x-request-id': 'request-1' },
				body: { title: 'Build' },
			})

			expect(result).toEqual({ id: 'project-1' })
			expect(requests).toEqual([
				{
					method: 'post',
					url: '/projects/Project%20A',
					params: { includeRepositories: true },
					headers: { 'x-request-id': 'request-1' },
					data: { title: 'Build' },
				},
			])
		})

		it('normalizes 204 responses to undefined bodies', async () => {
			const routeClient = createRouteContractAxiosClient<ExampleRouteContract>({
				request<T>() {
					return Promise.resolve({ data: '' as T, status: 204 })
				},
			})

			await expect(
				routeClient.request('delete', '/api/projects/:projectId', { params: { projectId: 'project-1' } }),
			).resolves.toBeUndefined()
		})

		it('returns Route Contract output body types', () => {
			const routeClient = createRouteContractAxiosClient<ExampleRouteContract>({
				request<T>() {
					return Promise.resolve({ data: null as T, status: 200 })
				},
			})

			expectTypeOf(
				routeClient.request('post', '/api/projects/:projectId', {
					params: { projectId: 'project-1' },
					query: {},
					headers: {},
					body: { title: 'Build' },
				}),
			).toEqualTypeOf<Promise<{ id: string }>>()
			expectTypeOf(routeClient.request('delete', '/api/projects/:projectId', { params: { projectId: 'project-1' } })).toEqualTypeOf<
				Promise<undefined>
			>()
		})
	})
}
