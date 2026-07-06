import { Domain } from '@gorchestra/core'
import { v } from 'valleyed'

import { selectionCookieName } from '../modules/selection-cookie'
import { sessionCookieName } from '../modules/sessions'
import { serverIdPipe } from '../server-id'
import {
	serverNonNegativeIntegerPipe,
	serverPaginatedQueryEnvelopePipe,
	serverPaginatedQueryInputPipe,
	serverPositiveIntegerPipe,
} from '../server-pagination'

export { serverIdPipe }
export { serverPaginatedQueryEnvelopePipe, serverPaginatedQueryInputPipe }
export const coreIdPipe = Domain.Commons.idPipe
export const idPipe = serverIdPipe
export const nonEmptyStringPipe = Domain.Commons.nonEmptyRawStringPipe
export const isoDateTimePipe = Domain.Commons.nonEmptyRawStringPipe
export const emailPipe = Domain.Commons.nonEmptyRawStringPipe.pipe(v.email())
export const positiveIntegerPipe = serverPositiveIntegerPipe
export const nonNegativeIntegerPipe = serverNonNegativeIntegerPipe

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
