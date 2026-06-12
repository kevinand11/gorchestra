import { Buffer } from 'node:buffer'

import type { Id } from '../../domain/commons'
import type { InvariantViolationError } from '../../errors'
import type { Result } from '../../utils/types'

export function sourceControlDeliveryBranchName(deliveryId: Id): Result<string, InvariantViolationError> {
	return validGeneratedBranch(`gorchestra/deliveries/d-${base64Url(deliveryId)}`)
}

export function sourceControlSliceBranchName(deliveryId: Id, sliceId: Id): Result<string, InvariantViolationError> {
	return validGeneratedBranch(`gorchestra/deliveries/d-${base64Url(deliveryId)}/slices/s-${base64Url(sliceId)}`)
}

function base64Url(value: string): string {
	return Buffer.from(value, 'utf8').toString('base64url')
}

function validGeneratedBranch(branch: string): Result<string, InvariantViolationError> {
	return isValidGeneratedBranchName(branch)
		? { ok: true, value: branch }
		: { ok: false, error: { type: 'invariant-violation', message: `Generated invalid source control branch name ${branch}.` } }
}

const branchValidators: Array<(branch: string) => boolean> = [
	(branch) => !branch.startsWith('/'),
	(branch) => !branch.endsWith('/'),
	(branch) => !branch.includes('//'),
	(branch) => !branch.includes('..'),
	(branch) => !branch.endsWith('.'),
	(branch) => branch.split('/').every(validBranchSegment),
	(branch) => [...branch].every(validBranchCharacter),
]

function isValidGeneratedBranchName(branch: string): boolean {
	return branchValidators.every((validator) => validator(branch))
}

function validBranchSegment(segment: string): boolean {
	return segment !== '' && !segment.startsWith('.') && !segment.endsWith('.lock')
}

function validBranchCharacter(character: string): boolean {
	const codePoint = character.codePointAt(0)
	return codePoint !== undefined && codePoint > 0x20 && !'~^:?*[\\'.includes(character)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('source-control branch names', () => {
		it('builds deterministic base64url Delivery Branch names without padding', () => {
			expect(sourceControlDeliveryBranchName('delivery/1')).toEqual({
				ok: true,
				value: 'gorchestra/deliveries/d-ZGVsaXZlcnkvMQ',
			})
		})

		it('builds deterministic nested Slice Branch names without raw unsafe id characters', () => {
			const result = sourceControlSliceBranchName('delivery:1', 'slice 1/2')

			expect(result).toEqual({
				ok: true,
				value: 'gorchestra/deliveries/d-ZGVsaXZlcnk6MQ/slices/s-c2xpY2UgMS8y',
			})
			if (result.ok) {
				expect(result.value).not.toContain('=')
				expect(result.value).not.toContain(':')
				expect(result.value).not.toContain(' ')
			}
		})
	})
}
