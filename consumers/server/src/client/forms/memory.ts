import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { CreateMemoryInput } from '../composables/useServerApi'

type MemoryFormFields = {
	parentId: string | null
	title: string
	body: string
}

const memoryTitlePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a Memory title'))
const memoryBodyPipe = v.string().pipe(v.asTrimmed())

export class MemoryFormDraft extends FormDraft<CreateMemoryInput, CreateMemoryInput, MemoryFormFields> {
	protected readonly rules = {
		parentId: v.nullable(v.string()),
		title: memoryTitlePipe,
		body: memoryBodyPipe,
	}

	constructor(parentId: string | null) {
		super({ parentId, title: '', body: '' })
	}

	protected model = (): CreateMemoryInput => ({ parentId: this.parentId, title: this.title, body: this.body })

	protected load = (entity: CreateMemoryInput): void => {
		this.parentId = entity.parentId
		this.title = entity.title
		this.body = entity.body
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('MemoryFormDraft', () => {
		it('models root Memories with trimmed title and body', () => {
			const draft = new MemoryFormDraft(null)

			draft.title = '  Route Contracts  '
			draft.body = '  Body  '

			expect(draft.valid).toBe(true)
			expect(draft.toModel()).toEqual({ parentId: null, title: 'Route Contracts', body: 'Body' })
		})

		it('models child Memories with a parent id', () => {
			const draft = new MemoryFormDraft('memory-parent')

			draft.title = 'Child'
			draft.body = ''

			expect(draft.toModel()).toEqual({ parentId: 'memory-parent', title: 'Child', body: '' })
		})

		it('rejects empty titles', () => {
			const draft = new MemoryFormDraft(null)

			draft.title = '  '

			expect(draft.valid).toBe(false)
			expect(draft.errors.title).toBe('Enter a Memory title')
		})
	})
}
