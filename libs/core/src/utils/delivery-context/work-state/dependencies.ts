import { ok } from './result'
import type { DependencyNode, WorkStateResult } from './types'
import type { Id } from '../../../domain/commons'
import type { Link } from '../../../domain/link'

export function compareAcceptedThenId(left: DependencyNode, right: DependencyNode): number {
	const byAccepted = left.accepted.at.localeCompare(right.accepted.at)
	if (byAccepted !== 0) return byAccepted

	return left.id.localeCompare(right.id)
}

export async function blockedDependencyIds<TNode extends DependencyNode, TLink extends Link>(
	links: Link[],
	isDependencyLink: (link: Link) => link is TLink,
	loadDependency: (link: TLink) => Promise<WorkStateResult<TNode | null>>,
): Promise<WorkStateResult<Id[]>> {
	const prerequisites: TNode[] = []
	for (const link of links.filter(isDependencyLink)) {
		const prerequisite = await loadDependency(link)
		if (!prerequisite.ok) return prerequisite
		if (prerequisite.value !== null) prerequisites.push(prerequisite.value)
	}

	return ok(prerequisites.sort(compareAcceptedThenId).map((blocked) => blocked.id))
}
