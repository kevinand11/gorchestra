import { v, type PipeOutput } from 'valleyed'

import { freeFormStringPipe, idPipe, isoDateTimePipe, nonEmptyTrimmedStringPipe, positiveIntegerPipe, runtimeRecordPipe } from './commons'

export const reviewSurfaceScopePipe = v.discriminate((value) => value.type, {
	slice: v.object({ type: v.eq('slice'), sliceId: idPipe, sliceArtifactId: idPipe }),
	delivery: v.object({ type: v.eq('delivery'), deliveryId: idPipe, deliveryArtifactId: idPipe }),
})
export type ReviewSurfaceScope = PipeOutput<typeof reviewSurfaceScopePipe>

export const reviewSurfaceConfigPipe = v.discriminate((value) => value.provider, {
	github: v.object({
		provider: v.eq('github'),
		pullRequestNumber: positiveIntegerPipe,
		repositoryId: idPipe,
		sourceBranch: nonEmptyTrimmedStringPipe,
		targetBranch: nonEmptyTrimmedStringPipe,
	}),
})
export type ReviewSurfaceConfig = PipeOutput<typeof reviewSurfaceConfigPipe>
export type ReviewSurfaceProvider = ReviewSurfaceConfig['provider']
export type GitHubPullRequestReviewSurfaceConfig = Extract<ReviewSurfaceConfig, { provider: 'github' }>

export const reviewSurfaceMergedConfigPipe = v.discriminate((value) => value.type, {
	'source-control': v.object({
		type: v.eq('source-control'),
		repositoryId: idPipe,
		sourceBranch: nonEmptyTrimmedStringPipe,
		targetBranch: nonEmptyTrimmedStringPipe,
	}),
})
export type ReviewSurfaceMergedConfig = PipeOutput<typeof reviewSurfaceMergedConfigPipe>
export type SourceControlReviewSurfaceMergedConfig = Extract<ReviewSurfaceMergedConfig, { type: 'source-control' }>

export const reviewSurfaceClosedPipe = v.discriminate((value) => value.type, {
	merged: v.object({ type: v.eq('merged'), merged: runtimeRecordPipe, config: reviewSurfaceMergedConfigPipe }),
	'closed-without-merge': v.object({ type: v.eq('closed-without-merge'), closed: runtimeRecordPipe }),
	replaced: v.object({ type: v.eq('replaced'), replaced: runtimeRecordPipe, reviewSurfaceId: idPipe }),
})
export type ReviewSurfaceClosed = PipeOutput<typeof reviewSurfaceClosedPipe>
export type ReviewSurfaceMerged = Extract<ReviewSurfaceClosed, { type: 'merged' }>
export type ReviewSurfaceClosedWithoutMerge = Extract<ReviewSurfaceClosed, { type: 'closed-without-merge' }>
export type ReviewSurfaceReplaced = Extract<ReviewSurfaceClosed, { type: 'replaced' }>

export const reviewSurfacePipe = v.object({
	id: idPipe,
	scope: reviewSurfaceScopePipe,
	config: reviewSurfaceConfigPipe,
	title: nonEmptyTrimmedStringPipe,
	closed: v.nullable(reviewSurfaceClosedPipe),
	created: runtimeRecordPipe,
})
export type ReviewSurface = PipeOutput<typeof reviewSurfacePipe>

export const fetchedFeedbackConfigPipe = v.discriminate((value) => value.provider, {
	github: v.object({
		provider: v.eq('github'),
		externalFeedbackId: nonEmptyTrimmedStringPipe,
		author: v.nullable(nonEmptyTrimmedStringPipe),
		url: v.nullable(nonEmptyTrimmedStringPipe),
	}),
})
export type FetchedFeedbackConfig = PipeOutput<typeof fetchedFeedbackConfigPipe>
export type FetchedFeedbackProvider = FetchedFeedbackConfig['provider']
export type GitHubFetchedFeedbackConfig = Extract<FetchedFeedbackConfig, { provider: 'github' }>

export const fetchedFeedbackPipe = v.object({
	reviewSurfaceId: idPipe,
	config: fetchedFeedbackConfigPipe,
	body: freeFormStringPipe,
	createdAt: v.nullable(isoDateTimePipe),
	updatedAt: v.nullable(isoDateTimePipe),
})
export type FetchedFeedback = PipeOutput<typeof fetchedFeedbackPipe>
