import { createHmac, timingSafeEqual } from 'node:crypto'

import { v, type Pipe, type PipeOutput } from 'valleyed'

function nonEmptyStringPipe() {
	return v.string().pipe(v.min(1))
}

const signedJwtPartsPipe = v
	.string()
	.pipe((token) => token.split('.'))
	.pipe(v.tuple([nonEmptyStringPipe(), nonEmptyStringPipe(), nonEmptyStringPipe()]))
	.pipe(([header, body, signature]) => ({ header, body, signature }))

type SignedJwtParts = PipeOutput<typeof signedJwtPartsPipe>

export function signJwtPayload(payload: unknown, signingKey: string): string {
	const header = encodeJwtPart({ alg: 'HS256', typ: 'JWT' })
	const body = encodeJwtPart(payload)
	const unsignedToken = `${header}.${body}`
	return `${unsignedToken}.${signJwtValue(unsignedToken, signingKey)}`
}

export function verifySignedJwtPayload<T extends Pipe<unknown, unknown>>(input: {
	token: string
	signingKey: string
	payloadPipe: T
}): PipeOutput<T> | null {
	const parts = parseWithPipe(signedJwtPartsPipe, input.token)
	if (!parts) return null
	if (!hasValidJwtSignature(parts, input.signingKey)) return null
	return parseWithPipe(input.payloadPipe, Buffer.from(parts.body, 'base64url').toString('utf8'))
}

function hasValidJwtSignature(parts: SignedJwtParts, signingKey: string): boolean {
	return timingSafeEqualText(parts.signature, signJwtValue(`${parts.header}.${parts.body}`, signingKey))
}

function encodeJwtPart(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function parseWithPipe<T extends Pipe<unknown, unknown>>(pipe: T, input: unknown): PipeOutput<T> | null {
	const parsed = v.validate(pipe, input)
	return parsed.valid ? parsed.value : null
}

function signJwtValue(value: string, signingKey: string): string {
	return createHmac('sha256', signingKey).update(value).digest('base64url')
}

function timingSafeEqualText(a: string, b: string): boolean {
	const left = Buffer.from(a)
	const right = Buffer.from(b)
	return left.length === right.length && timingSafeEqual(left, right)
}
