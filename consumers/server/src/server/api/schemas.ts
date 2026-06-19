import { v, type Pipe, type PipeOutput } from 'valleyed'

import type {
	AccessibleWorkspacePortfolio,
	EmailAuthenticationIdentity,
	EmailOtpChallengeResponse,
	EmailOtpSignInResponse,
	PortfolioRegistryEntry,
	ProvisionedWorkspaceResponse,
	RefreshedSessionResponse,
	SelectedPortfolio,
	SelectionAccessResponse,
	SelectionClearedResponse,
	ServerSession,
	ServerUser,
	SessionStatusResponse,
	SignedOutResponse,
	Workspace,
	WorkspaceMember,
	WorkspaceOwnerRole,
	WorkspacePortfoliosResponse,
} from '../../shared/api'
import { selectionCookieName } from '../modules/selection-cookie'
import { sessionCookieName } from '../modules/sessions'

const idPipe = v.string().pipe(v.min(1))
const nonEmptyStringPipe = v.string().pipe(v.min(1))
const isoDateTimePipe = v.string().pipe(v.min(1))
const emailPipe = v.string().pipe(v.email(), v.min(1))

type ExactResponsePipe<Expected, Schema extends Pipe<unknown, unknown>> = [PipeOutput<Schema>] extends [Expected]
	? [Expected] extends [PipeOutput<Schema>]
		? Schema
		: never
	: never

function responseSchema<Expected>() {
	return <Schema extends Pipe<unknown, unknown>>(schema: ExactResponsePipe<Expected, Schema>): Schema => schema
}

export const serverUserResponseSchema = responseSchema<ServerUser>()(
	v.object({
		id: idPipe,
		createdAt: isoDateTimePipe,
	}),
)

export const emailAuthenticationIdentityResponseSchema = responseSchema<EmailAuthenticationIdentity>()(
	v.object({
		id: idPipe,
		userId: idPipe,
		email: emailPipe,
		createdAt: isoDateTimePipe,
	}),
)

export const sessionResponseSchema = responseSchema<ServerSession>()(
	v.object({
		userId: idPipe,
		email: emailPipe,
		sessionId: idPipe,
		issuedAt: isoDateTimePipe,
		expiresAt: isoDateTimePipe,
	}),
)

export const workspaceResponseSchema = responseSchema<Workspace>()(
	v.object({
		id: idPipe,
		displayName: nonEmptyStringPipe,
		createdAt: isoDateTimePipe,
	}),
)

export const workspaceMemberResponseSchema = responseSchema<WorkspaceMember>()(
	v.object({
		id: idPipe,
		workspaceId: idPipe,
		userId: idPipe,
		membershipStartedAt: isoDateTimePipe,
		membershipEndedAt: v.nullable(isoDateTimePipe),
	}),
)

export const workspaceOwnerRoleResponseSchema = responseSchema<WorkspaceOwnerRole>()(
	v.object({
		id: idPipe,
		workspaceId: idPipe,
		workspaceMemberId: idPipe,
		assignedAt: isoDateTimePipe,
		revokedAt: v.nullable(isoDateTimePipe),
	}),
)

export const portfolioRegistryEntryResponseSchema = responseSchema<PortfolioRegistryEntry>()(
	v.object({
		id: idPipe,
		workspaceId: idPipe,
		displayName: nonEmptyStringPipe,
		coreStorageNamespace: nonEmptyStringPipe,
		registeredAt: isoDateTimePipe,
	}),
)

export const selectedPortfolioResponseSchema = responseSchema<SelectedPortfolio>()(
	v.object({
		workspaceId: idPipe,
		portfolioId: idPipe,
		issuedAt: isoDateTimePipe,
		expiresAt: isoDateTimePipe,
	}),
)

export const accessibleWorkspacePortfolioResponseSchema = responseSchema<AccessibleWorkspacePortfolio>()(
	v.object({
		workspace: workspaceResponseSchema,
		workspaceMember: workspaceMemberResponseSchema,
		portfolio: portfolioRegistryEntryResponseSchema,
		activeWorkspaceOwnerRole: v.nullable(workspaceOwnerRoleResponseSchema),
	}),
)

export const emailOtpChallengeResponseSchema = responseSchema<EmailOtpChallengeResponse>()(v.object({ requested: v.is(true as const) }))

export const emailOtpSignInResponseSchema = responseSchema<EmailOtpSignInResponse>()(
	v.object({
		signedIn: v.is(true as const),
		user: serverUserResponseSchema,
		emailAuthenticationIdentity: emailAuthenticationIdentityResponseSchema,
		createdUser: v.boolean(),
		session: sessionResponseSchema,
	}),
)

export const sessionAuthenticationResponseSchema = responseSchema<SessionStatusResponse>()(
	v.or([
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
	]),
)

export const refreshedSessionResponseSchema = responseSchema<RefreshedSessionResponse>()(
	v.object({
		refreshed: v.is(true as const),
		session: sessionResponseSchema,
	}),
)

export const signedOutResponseSchema = responseSchema<SignedOutResponse>()(v.object({ signedOut: v.is(true as const) }))

export const workspacePortfoliosResponseSchema = responseSchema<WorkspacePortfoliosResponse>()(
	v.object({
		workspacePortfolios: v.array(accessibleWorkspacePortfolioResponseSchema),
	}),
)

export const provisionedWorkspaceResponseSchema = responseSchema<ProvisionedWorkspaceResponse>()(
	v.object({
		provisioned: v.is(true as const),
		workspace: workspaceResponseSchema,
		workspaceMember: workspaceMemberResponseSchema,
		workspaceOwnerRole: workspaceOwnerRoleResponseSchema,
		portfolio: portfolioRegistryEntryResponseSchema,
		selection: selectedPortfolioResponseSchema,
	}),
)

export const selectionAccessResponseSchema = responseSchema<SelectionAccessResponse>()(
	v.or([
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
	]),
)

export const selectionClearedResponseSchema = responseSchema<SelectionClearedResponse>()(
	v.object({
		selected: v.is(false as const),
		reason: v.is('cleared' as const),
	}),
)

export const sessionResponseCookieSchema = v.object({ [sessionCookieName]: v.string() })
export const selectionResponseCookieSchema = v.object({ [selectionCookieName]: v.string() })
export const signedOutResponseCookieSchema = v.object({ [sessionCookieName]: v.string(), [selectionCookieName]: v.string() })
