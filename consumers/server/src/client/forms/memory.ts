import { v } from 'valleyed'

import { BaseFactory } from './factory'
import type { CreateMemoryInput } from '../composables/useServerApi'

type MemoryCreationType = Exclude<CreateMemoryInput['type'], null> | 'uncategorized'

type MemoryCreationFormFields = {
	title: string
	body: string
	memoryType: MemoryCreationType
	supersededMemoryId: string
}

const memoryTitlePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a Memory title'))
const memoryBodyPipe = v.string()
const memoryTypePipe = v.in([
	'uncategorized',
	'decision',
	'fact',
	'constraint',
	'assumption',
	'risk',
	'architecture',
	'workflow',
	'convention',
])
const supersededMemoryIdPipe = v.string().pipe(v.asTrimmed())

export class MemoryCreationFormFactory extends BaseFactory<CreateMemoryInput, CreateMemoryInput, MemoryCreationFormFields> {
	protected readonly rules = {
		title: memoryTitlePipe,
		body: memoryBodyPipe,
		memoryType: memoryTypePipe,
		supersededMemoryId: supersededMemoryIdPipe,
	}

	constructor() {
		super({ title: '', body: '', memoryType: 'uncategorized', supersededMemoryId: '' })
		this.initialize()
	}

	protected model = (): CreateMemoryInput => ({
		title: this.title,
		body: normalizeBody(this.body),
		type: this.memoryType === 'uncategorized' ? null : this.memoryType,
		links: this.supersededMemoryId === '' ? [] : [{ type: 'supersedes', toMemoryId: this.supersededMemoryId }],
	})

	protected load = (entity: CreateMemoryInput): void => {
		this.title = entity.title
		this.body = entity.body
		this.memoryType = entity.type ?? 'uncategorized'
		this.supersededMemoryId = entity.links[0]?.toMemoryId ?? ''
	}
}

function normalizeBody(body: string): string {
	return body.trim().length === 0 ? '' : body
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('MemoryCreationFormFactory', () => {
		it('models Standalone Memories with trimmed titles, optional body, and Uncategorized type', () => {
			const factory = new MemoryCreationFormFactory()

			factory.title = '  Route Contracts  '
			factory.body = '   '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ title: 'Route Contracts', body: '', type: null, links: [] })
		})

		it('preserves nonblank Memory body text and models optional supersession Links', () => {
			const factory = new MemoryCreationFormFactory()

			factory.title = 'Convention'
			factory.body = '  Preserve leading and trailing spaces.  '
			factory.memoryType = 'convention'
			factory.supersededMemoryId = ' memory-1 '

			expect(factory.toModel()).toEqual({
				title: 'Convention',
				body: '  Preserve leading and trailing spaces.  ',
				type: 'convention',
				links: [{ type: 'supersedes', toMemoryId: 'memory-1' }],
			})
		})

		it('rejects empty Memory titles', () => {
			const factory = new MemoryCreationFormFactory()

			factory.title = '  '

			expect(factory.valid).toBe(false)
			expect(factory.errors.title).toBe('Enter a Memory title')
		})
	})
}
