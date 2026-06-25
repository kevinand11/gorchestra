import type { GraphNodeRef, Link } from '../domain/graph'
import type { Memory } from '../domain/memory'

export type MemoryStatus = 'current' | 'superseded'

export type MemoryReadModel = Memory & {
	status: MemoryStatus
	links: Link[]
}

export function memoryReadModel(memory: Memory, links: Link[]): MemoryReadModel {
	return { ...memory, status: memoryStatus(memory, links), links: linksForMemory(memory.id, links) }
}

export function memoryReadModels(memories: Memory[], links: Link[]): MemoryReadModel[] {
	return memories.map((memory) => memoryReadModel(memory, links))
}

export function linksForMemory(memoryId: string, links: Link[]): Link[] {
	return links.filter((link) => graphRefKey(link.from) === memoryRefKey(memoryId) || graphRefKey(link.to) === memoryRefKey(memoryId))
}

function memoryStatus(memory: Memory, links: Link[]): MemoryStatus {
	return links.some((link) => link.type === 'supersedes' && graphRefKey(link.to) === memoryRefKey(memory.id)) ? 'superseded' : 'current'
}

export function graphRefKey(ref: GraphNodeRef): string {
	return `${ref.type}:${ref.id}`
}

export function memoryRefKey(memoryId: string): string {
	return `memory:${memoryId}`
}
