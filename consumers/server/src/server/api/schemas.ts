import { v } from 'valleyed'

import { selectionCookieName } from '../modules/selection-cookie'
import { sessionCookieName } from '../modules/sessions'

const idPipe = v.string().pipe(v.min(1))
const nonEmptyStringPipe = v.string().pipe(v.min(1))
const isoDateTimePipe = v.string().pipe(v.min(1))
const emailPipe = v.string().pipe(v.email(), v.min(1))
const integerPipe = v.number().pipe(v.int())
const positiveIntegerPipe = integerPipe.pipe(v.gte(1))
const nonNegativeIntegerPipe = integerPipe.pipe(v.gte(0))

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

const localActorRefResponseSchema = v.object({ type: v.string(), id: v.string() })
const auditStampResponseSchema = v.discriminate((value) => value.origin, {
	local: v.object({
		origin: v.is('local' as const),
		at: isoDateTimePipe,
		actor: localActorRefResponseSchema,
		correlationId: v.nullable(v.string()),
	}),
	imported: v.object({ origin: v.is('imported' as const), at: isoDateTimePipe }),
})
const deliveryWorkConfigResponseSchema = v.object({
	maxProcessableSliceSlots: positiveIntegerPipe,
	maxCorrectionRetriesPerFailure: nonNegativeIntegerPipe,
	modelTimeoutMs: positiveIntegerPipe,
})
const projectModelConfigResponseSchema = v.object({
	planningModelId: v.nullable(idPipe),
	revisionPlanningModelId: v.nullable(idPipe),
	executionModelId: v.nullable(idPipe),
	revisionExecutionModelId: v.nullable(idPipe),
})
const projectConfigResponseSchema = v.object({
	model: v.nullable(projectModelConfigResponseSchema),
	work: v.nullable(deliveryWorkConfigResponseSchema),
})
const projectConfigRecordResponseSchema = v.object({ configured: auditStampResponseSchema, value: v.nullable(projectConfigResponseSchema) })
const githubRepositoryConfigResponseSchema = v.object({
	provider: v.is('github' as const),
	owner: nonEmptyStringPipe,
	name: nonEmptyStringPipe,
	secretId: idPipe,
})
const repositoryConfigResponseSchema = v.discriminate((value) => value.provider, { github: githubRepositoryConfigResponseSchema })
const repositoryResponseSchema = v.object({
	id: idPipe,
	projectId: idPipe,
	config: repositoryConfigResponseSchema,
	created: auditStampResponseSchema,
})
const listedProjectSourceResponseSchema = v.discriminate((value) => value.type, {
	'source-control': v.object({ type: v.is('source-control' as const), repositories: v.array(repositoryResponseSchema) }),
})
export const listedProjectResponseSchema = v.object({
	id: idPipe,
	title: nonEmptyStringPipe,
	source: listedProjectSourceResponseSchema,
	config: v.nullable(projectConfigRecordResponseSchema),
	created: auditStampResponseSchema,
})
export const portfolioProjectsResponseSchema = v.array(listedProjectResponseSchema)

export const noContentResponseSchema = v.any<undefined>()

export const emailOtpChallengeResponseSchema = noContentResponseSchema

export const emailOtpSignInResponseSchema = v.object({
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

export const refreshedSessionResponseSchema = sessionResponseSchema

export const signedOutResponseSchema = noContentResponseSchema

export const workspacePortfoliosResponseSchema = v.array(accessibleWorkspacePortfolioResponseSchema)

export const provisionedWorkspaceResponseSchema = v.object({
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

export const selectionClearedResponseSchema = noContentResponseSchema

export const sessionResponseCookieSchema = v.object({ [sessionCookieName]: v.string() })
export const selectionResponseCookieSchema = v.object({ [selectionCookieName]: v.string() })
export const signedOutResponseCookieSchema = v.object({ [sessionCookieName]: v.string(), [selectionCookieName]: v.string() })
