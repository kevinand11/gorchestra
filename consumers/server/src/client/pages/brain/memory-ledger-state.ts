import { v, type Pipe } from 'valleyed'

import type { ListMemoriesInput } from '../../composables/useServerApi'

type QueryValue = string | string[] | null | undefined
type QueryState = Record<string, QueryValue>
type RouteWithQuery = { query: QueryState }
type MemoryStatus = ListMemoriesInput['status']
type MemoryType = 'decision' | 'fact' | 'constraint' | 'assumption' | 'risk' | 'architecture' | 'workflow' | 'convention' | null
type LinkType = 'produced' | 'references' | 'supersedes' | 'supports' | 'contradicts' | 'depends-on'
type GraphNodeType = 'project' | 'plan' | 'delivery' | 'slice' | 'memory'
type GraphNodeSelector = { type: 'node-type'; nodeType: GraphNodeType } | { type: 'node'; node: { type: GraphNodeType; id: string } }

const statusQueryPipe = v.fromJson(v.in(['current', 'superseded', 'all'] as const))
const searchQueryStringPipe = v.string().pipe(
	v.asTrimmed(),
	v.min(1),
	v.custom((value) => value !== 'null'),
)
const searchQueryPipe = v.fromJson(v.nullable(searchQueryStringPipe))
const memoryTypeValuePipe = v.nullable(
	v.in(['decision', 'fact', 'constraint', 'assumption', 'risk', 'architecture', 'workflow', 'convention'] as const),
)
const memoryTypeFilterPipe = v.fromJson(
	v.discriminate((value) => value.type, {
		all: v.object({ type: v.eq('all') }),
		types: v.object({ type: v.eq('types'), values: v.array(memoryTypeValuePipe).pipe(v.min(1)) }),
	}),
)
const graphNodeTypePipe = v.in(['project', 'plan', 'delivery', 'slice', 'memory'] as const)
const graphNodeRefPipe = v.discriminate((value) => value.type, {
	project: v.object({ type: v.eq('project'), id: v.string().pipe(v.asTrimmed(), v.min(1)) }),
	plan: v.object({ type: v.eq('plan'), id: v.string().pipe(v.asTrimmed(), v.min(1)) }),
	delivery: v.object({ type: v.eq('delivery'), id: v.string().pipe(v.asTrimmed(), v.min(1)) }),
	slice: v.object({ type: v.eq('slice'), id: v.string().pipe(v.asTrimmed(), v.min(1)) }),
	memory: v.object({ type: v.eq('memory'), id: v.string().pipe(v.asTrimmed(), v.min(1)) }),
})
const graphNodeSelectorPipe = v.discriminate((value) => value.type, {
	'node-type': v.object({ type: v.eq('node-type'), nodeType: graphNodeTypePipe }),
	node: v.object({ type: v.eq('node'), node: graphNodeRefPipe }),
})
const linkTypePipe = v.in(['produced', 'references', 'supersedes', 'supports', 'contradicts', 'depends-on'] as const)
const linkTypeFilterPipe = v.discriminate((value) => value.type, {
	all: v.object({ type: v.eq('all') }),
	types: v.object({ type: v.eq('types'), values: v.array(linkTypePipe).pipe(v.min(1)) }),
})
const linkedNodeFilterPipe = v.discriminate((value) => value.type, {
	all: v.object({ type: v.eq('all') }),
	nodes: v.object({ type: v.eq('nodes'), values: v.array(graphNodeSelectorPipe).pipe(v.min(1)) }),
})
const linkFilterPipe = v.fromJson(
	v.discriminate((value) => value.type, {
		none: v.object({ type: v.eq('none') }),
		filters: v.object({
			type: v.eq('filters'),
			match: v.in(['any', 'all'] as const),
			filters: v.array(v.object({ linkTypes: linkTypeFilterPipe, linkedNodes: linkedNodeFilterPipe })).pipe(v.min(1)),
		}),
	}),
)
export type MemoryLedgerDraft = {
	status: MemoryStatus
	search: string
	memoryType: 'all' | Exclude<MemoryType, null> | 'uncategorized'
	linkedBy: 'any' | Exclude<LinkType, 'depends-on'>
	linkedTo: 'any' | GraphNodeType
}

function defaultListMemoriesInput(): ListMemoriesInput {
	return { status: 'current', search: null, typeFilter: { type: 'all' }, linkFilter: { type: 'none' } }
}

export function listMemoriesInputFromRoute(route: RouteWithQuery): ListMemoriesInput {
	const defaults = defaultListMemoriesInput()
	return {
		status: queryValue(route.query.status, defaults.status, statusQueryPipe),
		search: queryValue(route.query.search, defaults.search, searchQueryPipe),
		typeFilter: queryValue(route.query.typeFilter, defaults.typeFilter, memoryTypeFilterPipe),
		linkFilter: queryValue(route.query.linkFilter, defaults.linkFilter, linkFilterPipe),
	}
}

export function draftFromInput(input: ListMemoriesInput): MemoryLedgerDraft {
	return {
		status: input.status,
		search: input.search ?? '',
		memoryType: memoryTypeValueFromFilter(input.typeFilter),
		...linkControlsFromFilter(input.linkFilter),
	}
}

export function queryFromDraft(draft: MemoryLedgerDraft, existingQuery: QueryState): QueryState {
	const { selectedMemoryId: _selectedMemoryId, ...query } = existingQuery
	return {
		...query,
		status: draft.status,
		search: searchQueryValue(draft.search),
		typeFilter: JSON.stringify(memoryTypeFilterFromValue(draft.memoryType)),
		linkFilter: JSON.stringify(linkFilterFromControls(draft.linkedBy, draft.linkedTo)),
	}
}

function queryValue<T>(value: QueryValue, fallback: T, pipe: Pipe<unknown, T>): T {
	const source = firstQueryValue(value)
	if (source === null) return fallback
	const result = v.validate(pipe, source)
	return result.valid ? result.value : fallback
}

function searchQueryValue(search: string): string {
	return search.trim() === '' ? 'null' : search.trim()
}

function memoryTypeValueFromFilter(filter: ListMemoriesInput['typeFilter']): MemoryLedgerDraft['memoryType'] {
	if (filter.type === 'all') return 'all'
	const value = filter.values[0]
	return value === null ? 'uncategorized' : (value ?? 'all')
}

function memoryTypeFilterFromValue(value: MemoryLedgerDraft['memoryType']): ListMemoriesInput['typeFilter'] {
	return value === 'all' ? { type: 'all' } : { type: 'types', values: [value === 'uncategorized' ? null : value] }
}

function linkControlsFromFilter(filter: ListMemoriesInput['linkFilter']): Pick<MemoryLedgerDraft, 'linkedBy' | 'linkedTo'> {
	if (filter.type === 'none') return { linkedBy: 'any', linkedTo: 'any' }
	const first = filter.filters[0]
	return { linkedBy: linkedByFromFilter(first), linkedTo: linkedToFromFilter(first) }
}

function linkedByFromFilter(
	filter: Exclude<ListMemoriesInput['linkFilter'], { type: 'none' }>['filters'][number] | undefined,
): MemoryLedgerDraft['linkedBy'] {
	return filter?.linkTypes.type === 'types' ? (visibleLinkType(filter.linkTypes.values[0]) ?? 'any') : 'any'
}

function linkedToFromFilter(
	filter: Exclude<ListMemoriesInput['linkFilter'], { type: 'none' }>['filters'][number] | undefined,
): MemoryLedgerDraft['linkedTo'] {
	return filter?.linkedNodes.type === 'nodes' ? (visibleLinkedNodeType(filter.linkedNodes.values[0]) ?? 'any') : 'any'
}

function linkFilterFromControls(
	linkedBy: MemoryLedgerDraft['linkedBy'],
	linkedTo: MemoryLedgerDraft['linkedTo'],
): ListMemoriesInput['linkFilter'] {
	return linkedBy === 'any' && linkedTo === 'any' ? { type: 'none' } : populatedLinkFilter(linkedBy, linkedTo)
}

function populatedLinkFilter(
	linkedBy: MemoryLedgerDraft['linkedBy'],
	linkedTo: MemoryLedgerDraft['linkedTo'],
): Exclude<ListMemoriesInput['linkFilter'], { type: 'none' }> {
	return {
		type: 'filters',
		match: 'any',
		filters: [{ linkTypes: linkTypesFromControl(linkedBy), linkedNodes: linkedNodesFromControl(linkedTo) }],
	}
}

function linkTypesFromControl(linkedBy: MemoryLedgerDraft['linkedBy']) {
	return linkedBy === 'any' ? { type: 'all' as const } : { type: 'types' as const, values: [linkedBy] }
}

function linkedNodesFromControl(linkedTo: MemoryLedgerDraft['linkedTo']) {
	return linkedTo === 'any'
		? { type: 'all' as const }
		: { type: 'nodes' as const, values: [{ type: 'node-type' as const, nodeType: linkedTo }] }
}

function visibleLinkType(value: LinkType | undefined): MemoryLedgerDraft['linkedBy'] | null {
	return value === undefined || value === 'depends-on' ? null : value
}

function visibleLinkedNodeType(selector: GraphNodeSelector | undefined): MemoryLedgerDraft['linkedTo'] | null {
	return selector?.type === 'node-type' ? selector.nodeType : null
}

function firstQueryValue(value: QueryValue): string | null {
	if (Array.isArray(value)) return value[0] ?? null
	return value ?? null
}
