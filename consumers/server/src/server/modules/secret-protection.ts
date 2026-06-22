import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { v } from 'valleyed'

export type SecretEncryptionKey = Buffer

const protectedSecretValuePrefix = 'gorchestra-secret-value:v1:'
const secretEncryptionAlgorithm = 'aes-256-gcm'
const secretEncryptionEnvelopePipe = v.fromJson(
	v.object({
		algorithm: v.is('A256GCM' as const),
		iv: v.string().pipe(v.min(1)),
		tag: v.string().pipe(v.min(1)),
		ciphertext: v.string().pipe(v.min(1)),
	}),
)

type SecretEncryptionEnvelope = {
	algorithm: 'A256GCM'
	iv: string
	tag: string
	ciphertext: string
}

export function parseSecretEncryptionKey(encodedKey: string): SecretEncryptionKey {
	const key = Buffer.from(encodedKey.trim(), 'base64url')
	if (key.byteLength !== 32) throw new Error('GORCHESTRA_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes')
	return key
}

export function protectSecretPlaintext(plaintext: string, key: SecretEncryptionKey): string {
	const iv = randomBytes(12)
	const cipher = createCipheriv(secretEncryptionAlgorithm, key, iv)
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
	const envelope: SecretEncryptionEnvelope = {
		algorithm: 'A256GCM',
		iv: encodeBase64Url(iv),
		tag: encodeBase64Url(cipher.getAuthTag()),
		ciphertext: encodeBase64Url(ciphertext),
	}
	return `${protectedSecretValuePrefix}${encodeBase64Url(Buffer.from(JSON.stringify(envelope), 'utf8'))}`
}

export function revealSecretPlaintext(valueRef: string, key: SecretEncryptionKey): string | null {
	const envelope = parseProtectedSecretValueRef(valueRef)
	if (envelope === null) return null

	try {
		const decipher = createDecipheriv(secretEncryptionAlgorithm, key, decodeBase64Url(envelope.iv))
		decipher.setAuthTag(decodeBase64Url(envelope.tag))
		return Buffer.concat([decipher.update(decodeBase64Url(envelope.ciphertext)), decipher.final()]).toString('utf8')
	} catch {
		return null
	}
}

function parseProtectedSecretValueRef(valueRef: string): SecretEncryptionEnvelope | null {
	if (!valueRef.startsWith(protectedSecretValuePrefix)) return null
	const json = decodeBase64Url(valueRef.slice(protectedSecretValuePrefix.length)).toString('utf8')
	const parsed = v.validate(secretEncryptionEnvelopePipe, json)
	const output: unknown = parsed.valid ? parsed.value : null
	return isSecretEncryptionEnvelope(output) ? output : null
}

function isSecretEncryptionEnvelope(input: unknown): input is SecretEncryptionEnvelope {
	if (!isRecord(input)) return false
	return input.algorithm === 'A256GCM' && stringPropertiesExist(input, ['iv', 'tag', 'ciphertext'])
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === 'object' && input !== null
}

function stringPropertiesExist(input: Record<string, unknown>, properties: string[]): boolean {
	return properties.every((property) => typeof input[property] === 'string')
}

function encodeBase64Url(input: Buffer): string {
	return input.toString('base64url')
}

function decodeBase64Url(input: string): Buffer {
	return Buffer.from(input, 'base64url')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Secret protection', () => {
		it('requires a 32-byte base64url encoded encryption key', () => {
			const encoded = Buffer.alloc(32, 1).toString('base64url')

			expect(parseSecretEncryptionKey(encoded)).toEqual(Buffer.alloc(32, 1))
			expect(() => parseSecretEncryptionKey(Buffer.alloc(31, 1).toString('base64url'))).toThrow(
				'GORCHESTRA_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes',
			)
		})

		it('protects plaintext in an opaque value ref and reveals it with the same key', () => {
			const key = parseSecretEncryptionKey(Buffer.alloc(32, 7).toString('base64url'))

			const valueRef = protectSecretPlaintext('  token-value  ', key)

			expect(valueRef).toMatch(/^gorchestra-secret-value:v1:/)
			expect(valueRef).not.toContain('token-value')
			expect(revealSecretPlaintext(valueRef, key)).toBe('  token-value  ')
		})

		it('does not reveal malformed refs or refs encrypted with another key', () => {
			const key = parseSecretEncryptionKey(Buffer.alloc(32, 1).toString('base64url'))
			const otherKey = parseSecretEncryptionKey(Buffer.alloc(32, 2).toString('base64url'))
			const valueRef = protectSecretPlaintext('token-value', key)

			expect(revealSecretPlaintext('not-an-envelope', key)).toBeNull()
			expect(revealSecretPlaintext(valueRef, otherKey)).toBeNull()
		})
	})
}
