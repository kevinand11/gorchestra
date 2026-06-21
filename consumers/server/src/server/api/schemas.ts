import { v } from 'valleyed'

import { selectionCookieName } from '../modules/selection-cookie'
import { sessionCookieName } from '../modules/sessions'

export const idPipe = v.string().pipe(v.min(1))
export const nonEmptyStringPipe = v.string().pipe(v.min(1))
export const isoDateTimePipe = v.string().pipe(v.min(1))
export const emailPipe = v.string().pipe(v.email(), v.min(1))
export const integerPipe = v.number().pipe(v.int())
export const positiveIntegerPipe = integerPipe.pipe(v.gte(1))
export const nonNegativeIntegerPipe = integerPipe.pipe(v.gte(0))

export const workspaceResponseSchema = v.object({
	id: idPipe,
	displayName: nonEmptyStringPipe,
	createdAt: isoDateTimePipe,
})

export const workspaceMemberResponseSchema = v.object({
	id: idPipe,
	workspaceId: idPipe,
	userId: idPipe,
	membershipStartedAt: isoDateTimePipe,
	membershipEndedAt: v.nullable(isoDateTimePipe),
})

export const workspaceOwnerRoleResponseSchema = v.object({
	id: idPipe,
	workspaceId: idPipe,
	workspaceMemberId: idPipe,
	assignedAt: isoDateTimePipe,
	revokedAt: v.nullable(isoDateTimePipe),
})

export const portfolioRegistryEntryResponseSchema = v.object({
	id: idPipe,
	workspaceId: idPipe,
	displayName: nonEmptyStringPipe,
	coreStorageNamespace: nonEmptyStringPipe,
	registeredAt: isoDateTimePipe,
})

export const selectedPortfolioResponseSchema = v.object({
	workspaceId: idPipe,
	portfolioId: idPipe,
	issuedAt: isoDateTimePipe,
	expiresAt: isoDateTimePipe,
})

export const noContentResponseSchema = v.any<undefined>()

export const sessionResponseCookieSchema = v.object({ [sessionCookieName]: v.string() })
export const selectionResponseCookieSchema = v.object({ [selectionCookieName]: v.string() })
export const signedOutResponseCookieSchema = v.object({ [sessionCookieName]: v.string(), [selectionCookieName]: v.string() })
