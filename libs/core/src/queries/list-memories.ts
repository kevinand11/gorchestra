import type { FilterGroup, SchemaFields } from 'equipped/orm'
import { v, type PipeOutput } from 'valleyed'

import { graphNodeRefPipe, linkTypePipe, type GraphNodeRef, type Link, type LinkType } from '../domain/graph'
import { memoryTypePipe, type Memory, type MemoryType } from '../domain/memory'
import type { InvalidCoreServiceOutputError, InvalidInputError, StorageOperationFailedError } from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { graphRefKey, memoryReadModels, memoryRefKey, type MemoryReadModel } from './memory-read-model'
import { listRecords, withTransaction } from '../storage/helpers'
import type { memorySchema } from '../storage/schemas'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

const memoryStatusFilterPipe = v.in(['current', 'superseded', 'all'])
const memoryTypeFilterValuePipe = v.nullable(memoryTypePipe)
const memoryTypeFilterPipe = v.discriminate((value) => value.type, {
	all: v.object({ type: v.eq('all') }),
	types: v.object({
		type: v.eq('types'),
		values: v.array(memoryTypeFilterValuePipe).pipe(v.min(1), v.asSet<MemoryType | null>(memoryTypeFilterValueKey)),
	}),
})
const graphNodeTypePipe = v.in(['project', 'plan', 'delivery', 'slice', 'memory'])
const graphNodeSelectorPipe = v.discriminate((value) => value.type, {
	'node-type': v.object({ type: v.eq('node-type'), nodeType: graphNodeTypePipe }),
	node: v.object({ type: v.eq('node'), node: graphNodeRefPipe }),
})
const linkTypeFilterPipe = v.discriminate((value) => value.type, {
	all: v.object({ type: v.eq('all') }),
	types: v.object({
		type: v.eq('types'),
		values: v.array(linkTypePipe).pipe(
			v.min(1),
			v.asSet<LinkType>((value) => value),
		),
	}),
})
const linkedNodeFilterPipe = v.discriminate((value) => value.type, {
	all: v.object({ type: v.eq('all') }),
	nodes: v.object({
		type: v.eq('nodes'),
		values: v.array(graphNodeSelectorPipe).pipe(v.min(1), v.asSet<GraphNodeSelector>(graphNodeSelectorKey)),
	}),
})
const directMemoryLinkFilterPipe = v.object({ linkTypes: linkTypeFilterPipe, linkedNodes: linkedNodeFilterPipe })
type DirectMemoryLinkFilter = PipeOutput<typeof directMemoryLinkFilterPipe>
const memoryLinkFilterSetPipe = v.discriminate((value) => value.type, {
	none: v.object({ type: v.eq('none') }),
	filters: v.object({
		type: v.eq('filters'),
		match: v.in(['any', 'all']),
		filters: v.array(directMemoryLinkFilterPipe).pipe(v.min(1), v.asSet<DirectMemoryLinkFilter>(directMemoryLinkFilterKey)),
	}),
})

const listMemoriesInputPipe = v.object({
	status: memoryStatusFilterPipe,
	search: v.nullable(v.string().pipe(v.asTrimmed(), v.min(1))),
	typeFilter: memoryTypeFilterPipe,
	linkFilter: memoryLinkFilterSetPipe,
})
export type Input = PipeOutput<typeof listMemoriesInputPipe>

type MemoryTypeFilter = PipeOutput<typeof memoryTypeFilterPipe>
type GraphNodeSelector = PipeOutput<typeof graphNodeSelectorPipe>
type LinkTypeFilter = PipeOutput<typeof linkTypeFilterPipe>
type LinkedNodeFilter = PipeOutput<typeof linkedNodeFilterPipe>
type MemoryLinkFilterSet = PipeOutput<typeof memoryLinkFilterSetPipe>
type MemorySchemaFields = SchemaFields<typeof memorySchema>

export type Result = MemoryReadModel[]
export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListMemoriesQuery(options: CoreServices): Operation {
	return buildQueryHandler('listMemories', listMemoriesInputPipe, (input) =>
		withTransaction(options, (storage) => listMemoryReadModels(storage, input)),
	)
}

async function listMemoryReadModels(storage: CoreStorage, input: Input): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const memories = await listRecords('memory', storage, { where: (filter, fields) => memoryStorageFilter(input, filter, fields) })
	if (!memories.ok) return memories
	if (memories.value.length === 0) return { ok: true, value: [] }

	const links = await linksForMemories(storage, memories.value)
	if (!links.ok) return links

	return { ok: true, value: filterAndSortReadModels(memoryReadModels(memories.value, links.value), input) }
}

function memoryStorageFilter(input: Input, filter: FilterGroup, fields: MemorySchemaFields): FilterGroup {
	let next = filter
	if (input.search !== null)
		next = next.or([
			(group: FilterGroup) => group.like(fields.title, input.search!),
			(group: FilterGroup) => group.like(fields.body, input.search!),
		])
	return applyTypeStorageFilter(next, fields, input.typeFilter)
}

function applyTypeStorageFilter(filter: FilterGroup, fields: MemorySchemaFields, typeFilter: MemoryTypeFilter): FilterGroup {
	return typeFilter.type === 'all' ? filter : applyTypeStorageFactories(filter, typeStorageFactories(fields, typeFilter.values))
}

function applyTypeStorageFactories(filter: FilterGroup, factories: Array<(group: FilterGroup) => FilterGroup>): FilterGroup {
	return factories.length === 1 ? factories[0]!(filter) : filter.or(factories)
}

function typeStorageFactories(fields: MemorySchemaFields, values: Array<MemoryType | null>): Array<(group: FilterGroup) => FilterGroup> {
	return [...nonNullTypeStorageFactories(fields, values), ...nullTypeStorageFactories(fields, values)]
}

function nonNullTypeStorageFactories(
	fields: MemorySchemaFields,
	values: Array<MemoryType | null>,
): Array<(group: FilterGroup) => FilterGroup> {
	const nonNullTypes = values.filter((value): value is MemoryType => value !== null)
	return nonNullTypes.length === 0 ? [] : [(group) => group.in(fields.type, nonNullTypes)]
}

function nullTypeStorageFactories(
	fields: MemorySchemaFields,
	values: Array<MemoryType | null>,
): Array<(group: FilterGroup) => FilterGroup> {
	return values.includes(null) ? [(group) => group.eq(fields.type, null)] : []
}

async function linksForMemories(
	storage: CoreStorage,
	memories: Memory[],
): Promise<CoreResult<Link[], InvalidCoreServiceOutputError | StorageOperationFailedError>> {
	const refs = memories.map((memory) => ({ type: 'memory' as const, id: memory.id }))
	return listRecords('link', storage, {
		where: (filter, fields) =>
			filter.or(refs.flatMap((ref) => [(group) => group.eq(fields.from, ref), (group) => group.eq(fields.to, ref)])),
	})
}

function filterAndSortReadModels(memories: MemoryReadModel[], input: Input): MemoryReadModel[] {
	return sortNewestFirst(memories.filter((memory) => matchesStatus(memory, input.status) && matchesLinkFilter(memory, input.linkFilter)))
}

function matchesStatus(memory: MemoryReadModel, status: Input['status']): boolean {
	return status === 'all' || memory.status === status
}

function matchesLinkFilter(memory: MemoryReadModel, filter: MemoryLinkFilterSet): boolean {
	if (filter.type === 'none') return true

	const matches = filter.filters.map((directFilter) =>
		memory.links.some((link) => matchesDirectLinkFilter(memory.id, link, directFilter)),
	)
	return filter.match === 'all' ? matches.every(Boolean) : matches.some(Boolean)
}

function matchesDirectLinkFilter(memoryId: string, link: Link, filter: DirectMemoryLinkFilter): boolean {
	return matchesLinkTypeFilter(link.type, filter.linkTypes) && matchesLinkedNodeFilter(otherNode(memoryId, link), filter.linkedNodes)
}

function matchesLinkTypeFilter(linkType: LinkType, filter: LinkTypeFilter): boolean {
	return filter.type === 'all' || filter.values.includes(linkType)
}

function matchesLinkedNodeFilter(node: GraphNodeRef, filter: LinkedNodeFilter): boolean {
	return filter.type === 'all' || filter.values.some((selector) => matchesGraphNodeSelector(node, selector))
}

function matchesGraphNodeSelector(node: GraphNodeRef, selector: GraphNodeSelector): boolean {
	return selector.type === 'node-type' ? node.type === selector.nodeType : graphRefKey(node) === graphRefKey(selector.node)
}

function otherNode(memoryId: string, link: Link): GraphNodeRef {
	return graphRefKey(link.from) === memoryRefKey(memoryId) ? link.to : link.from
}

function sortNewestFirst<T extends { id: string; created: { at: string } }>(records: T[]): T[] {
	return [...records].sort((left, right) => right.created.at.localeCompare(left.created.at) || right.id.localeCompare(left.id))
}

function memoryTypeFilterValueKey(value: MemoryType | null): string {
	return value ?? 'uncategorized'
}

function graphNodeSelectorKey(selector: GraphNodeSelector): string {
	return selector.type === 'node-type' ? `node-type:${selector.nodeType}` : `node:${graphRefKey(selector.node)}`
}

function directMemoryLinkFilterKey(filter: DirectMemoryLinkFilter): string {
	return JSON.stringify({ linkTypes: linkTypeFilterKey(filter.linkTypes), linkedNodes: linkedNodeFilterKey(filter.linkedNodes) })
}

function linkTypeFilterKey(filter: LinkTypeFilter): string {
	return filter.type === 'all' ? 'all' : filter.values.join('|')
}

function linkedNodeFilterKey(filter: LinkedNodeFilter): string {
	return filter.type === 'all' ? 'all' : filter.values.map(graphNodeSelectorKey).join('|')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, stamp } = await import('../utils/test-helpers')

	describe('listMemories query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.memories.fail.list = true

			const result = await createListMemoriesQuery(options)({} as Input)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listMemories' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('lists Memory read models newest first with status and all direct Links', async () => {
			const records = seedMemoryListRecords()

			const result = await createListMemoriesQuery(records.options)(defaultInput())

			expect(result).toEqual({
				ok: true,
				value: [
					{ ...records.currentLater, status: 'current', links: [records.producedLink, records.supersedesLink] },
					{ ...records.currentTieB, status: 'current', links: [] },
				],
			})
		})

		it('filters by search and Memory type through Memory storage fields', async () => {
			const records = seedMemoryListRecords()

			const result = await createListMemoriesQuery(records.options)({
				...defaultInput(),
				search: 'route.contract',
				typeFilter: { type: 'types', values: ['architecture'] },
			})

			expect(result).toEqual({
				ok: true,
				value: [{ ...records.currentLater, status: 'current', links: [records.producedLink, records.supersedesLink] }],
			})
		})

		it('filters by status and direct Links including archived Links', async () => {
			const records = seedMemoryListRecords()

			const result = await createListMemoriesQuery(records.options)({
				...defaultInput(),
				status: 'all',
				linkFilter: {
					type: 'filters',
					match: 'any',
					filters: [
						{
							linkTypes: { type: 'types', values: ['supports'] },
							linkedNodes: { type: 'nodes', values: [{ type: 'node-type', nodeType: 'delivery' }] },
						},
					],
				},
			})

			expect(result).toEqual({
				ok: true,
				value: [{ ...records.superseded, status: 'superseded', links: [records.supersedesLink, records.archivedSupportsLink] }],
			})
		})

		it('returns storage errors when Memory or Link reads fail', async () => {
			await expect(createListMemoriesQuery(memoryListReadFailure('memory'))(defaultInput())).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'memory' } },
			})
			await expect(createListMemoriesQuery(memoryListReadFailure('link'))(defaultInput())).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'link' } },
			})
		})
	})

	function defaultInput(): Input {
		return { status: 'current', search: null, typeFilter: { type: 'all' }, linkFilter: { type: 'none' } }
	}

	function seedMemoryListRecords() {
		const options = createTestCoreServices()
		const currentLater = memory({
			id: 'memory-b',
			title: 'Route contract boundary',
			body: 'Use route.contract literal search.',
			type: 'architecture',
			createdAt: '2026-06-10T00:00:00.000Z',
		})
		const currentTieB = memory({ id: 'memory-c', title: 'Tie C', body: '', type: null, createdAt: '2026-06-09T00:00:00.000Z' })
		const superseded = memory({
			id: 'memory-a',
			title: 'Old risk',
			body: 'Superseded risk.',
			type: 'risk',
			createdAt: '2026-06-09T00:00:00.000Z',
		})
		for (const record of [currentLater, currentTieB, superseded]) options.tx.memories.records.set(record.id, record)
		const producedLink = link('link-produced', 'produced', { type: 'plan', id: 'plan-1' }, { type: 'memory', id: currentLater.id })
		const supersedesLink = link(
			'link-supersedes',
			'supersedes',
			{ type: 'memory', id: currentLater.id },
			{ type: 'memory', id: superseded.id },
		)
		const archivedSupportsLink = link(
			'link-supports',
			'supports',
			{ type: 'memory', id: superseded.id },
			{ type: 'delivery', id: 'delivery-1' },
			true,
		)
		for (const record of [producedLink, supersedesLink, archivedSupportsLink]) options.tx.links.records.set(record.id, record)
		return { options, currentLater, currentTieB, superseded, producedLink, supersedesLink, archivedSupportsLink }
	}

	function memory(input: { id: string; title: string; body: string; type: MemoryType | null; createdAt: string }): Memory {
		return {
			id: input.id,
			title: input.title,
			body: input.body,
			type: input.type,
			created: { origin: 'imported', at: input.createdAt },
		}
	}

	function link(id: string, type: LinkType, from: GraphNodeRef, to: GraphNodeRef, archived = false): Link {
		return { id, type, from, to, created: stamp, archivePeriods: archived ? [{ archived: stamp, unarchived: null }] : [] }
	}

	function memoryListReadFailure(resource: 'memory' | 'link') {
		const options = createTestCoreServices()
		options.tx.memories.records.set('memory-1', memory({ id: 'memory-1', title: 'Memory', body: '', type: null, createdAt: stamp.at }))
		if (resource === 'memory') options.tx.memories.fail.list = true
		if (resource === 'link') options.tx.links.fail.list = true
		return options
	}
}
