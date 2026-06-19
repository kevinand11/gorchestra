import { v } from 'valleyed'

import { selectionCookieName } from '../modules/selection-cookie'
import { sessionCookieName } from '../modules/sessions'

const idPipe = v.string().pipe(v.min(1))
const nonEmptyStringPipe = v.string().pipe(v.min(1))
const isoDateTimePipe = v.string().pipe(v.min(1))
const emailPipe = v.string().pipe(v.email(), v.min(1))

export const serverUserResponseSchema = v.object({
	id: idPipe,
	createdAt: isoDateTimePipe,
})

export const emailAuthenticationIdentityResponseSchema = v.object({
	id: idPipe,
	userId: idPipe,
	email: emailPipe,
	createdAt: isoDateTimePipe,
})

export const sessionResponseSchema = v.object({
	userId: idPipe,
	email: emailPipe,
	sessionId: idPipe,
	issuedAt: isoDateTimePipe,
	expiresAt: isoDateTimePipe,
})

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

export const accessibleWorkspacePortfolioResponseSchema = v.object({
	workspace: workspaceResponseSchema,
	workspaceMember: workspaceMemberResponseSchema,
	portfolio: portfolioRegistryEntryResponseSchema,
	activeWorkspaceOwnerRole: v.nullable(workspaceOwnerRoleResponseSchema),
})

export const emailOtpChallengeResponseSchema = v.object({ requested: v.is(true as const) })

export const emailOtpSignInResponseSchema = v.object({
	signedIn: v.is(true as const),
	user: serverUserResponseSchema,
	emailAuthenticationIdentity: emailAuthenticationIdentityResponseSchema,
	createdUser: v.boolean(),
	session: sessionResponseSchema,
})

export const sessionAuthenticationResponseSchema = v.or([
	v.object({
		authenticated: v.is(true as const),
		session: sessionResponseSchema,
		tokenStatus: v.in(['current', 'previous-grace'] as const),
		refreshRecommended: v.boolean(),
	}),
	v.object({
		authenticated: v.is(false as const),
		reason: v.in(['missing-token', 'invalid-token', 'expired', 'not-current'] as const),
	}),
])

export const refreshedSessionResponseSchema = v.object({
	refreshed: v.is(true as const),
	session: sessionResponseSchema,
})

export const signedOutResponseSchema = v.object({ signedOut: v.is(true as const) })

export const workspacePortfoliosResponseSchema = v.object({
	workspacePortfolios: v.array(accessibleWorkspacePortfolioResponseSchema),
})

export const provisionedWorkspaceResponseSchema = v.object({
	provisioned: v.is(true as const),
	workspace: workspaceResponseSchema,
	workspaceMember: workspaceMemberResponseSchema,
	workspaceOwnerRole: workspaceOwnerRoleResponseSchema,
	portfolio: portfolioRegistryEntryResponseSchema,
	selection: selectedPortfolioResponseSchema,
})

export const selectionAccessResponseSchema = v.or([
	v.object({
		selected: v.is(true as const),
		selection: selectedPortfolioResponseSchema,
		workspace: workspaceResponseSchema,
		workspaceMember: workspaceMemberResponseSchema,
		portfolio: portfolioRegistryEntryResponseSchema,
		activeWorkspaceOwnerRole: v.nullable(workspaceOwnerRoleResponseSchema),
	}),
	v.object({
		selected: v.is(false as const),
		reason: v.in([
			'missing-token',
			'invalid-token',
			'expired',
			'user-not-found',
			'workspace-not-found',
			'not-active-member',
			'portfolio-not-found',
		] as const),
	}),
])

export const selectionClearedResponseSchema = v.object({
	selected: v.is(false as const),
	reason: v.is('cleared' as const),
})

export const sessionResponseCookieSchema = v.object({ [sessionCookieName]: v.string() })
export const selectionResponseCookieSchema = v.object({ [selectionCookieName]: v.string() })
export const signedOutResponseCookieSchema = v.object({ [sessionCookieName]: v.string(), [selectionCookieName]: v.string() })
