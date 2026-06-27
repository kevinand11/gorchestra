import { v } from 'valleyed'

import { BaseFactory } from './factory'
import type { CreateLinkInput } from '../composables/useServerApi'

type MemoryLinkCreationType = CreateLinkInput['type']

type MemoryLinkCreationFormFields = {
	type: MemoryLinkCreationType
	sourceMemoryId: string
	targetMemoryId: string
}

export const memoryLinkCreationTypeOptions = [
	{ value: 'references', label: 'References' },
	{ value: 'supports', label: 'Supports' },
	{ value: 'contradicts', label: 'Contradicts' },
	{ value: 'supersedes', label: 'Supersedes' },
] as const

export class LinkCreationFormFactory extends BaseFactory<CreateLinkInput, CreateLinkInput, MemoryLinkCreationFormFields> {
	protected readonly rules = {
		type: v.in(['references', 'supports', 'contradicts', 'supersedes']),
		sourceMemoryId: v.string(),
		targetMemoryId: v.string().pipe(v.lazy(() => v.ne(this.sourceMemoryId))),
	}

	constructor({ sourceMemoryId }: { sourceMemoryId: string }) {
		super({ type: 'references', sourceMemoryId, targetMemoryId: '' })
	}

	protected model = (): CreateLinkInput => ({
		type: this.type,
		from: { type: 'memory', id: this.sourceMemoryId },
		to: { type: 'memory', id: this.targetMemoryId },
	})

	protected load = (entity: CreateLinkInput): void => {
		this.type = entity.type
		this.sourceMemoryId = entity.from.id
		this.targetMemoryId = entity.to.id
	}
}
