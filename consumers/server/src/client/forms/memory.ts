import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { CreateMemoryInput, CreateMemoryRevisionInput } from '../composables/useServerApi'

type MemoryCreationFormFields = {
	parentId: string | null
	title: string
	body: string
}

type MemoryRevisionFormEntity = {
	expectedCurrentRevisionId: string
	title: string
	body: string
}

type MemoryRevisionFormFields = MemoryRevisionFormEntity

const memoryTitlePipe = v.string().pipe(v.min<string>(1, 'Enter a Memory title'))
const memoryBodyPipe = v.string()

export class MemoryCreationFormDraft extends FormDraft<CreateMemoryInput, CreateMemoryInput, MemoryCreationFormFields> {
	protected readonly rules = {
		parentId: v.nullable(v.string()),
		title: memoryTitlePipe,
		body: memoryBodyPipe,
	}

	constructor(parentId: string | null) {
		super({ parentId, title: '', body: '' })
		this.reserved = ['parentId']
	}

	protected model = (): CreateMemoryInput => ({ parentId: this.parentId, title: this.title, body: this.body })

	protected load = (entity: CreateMemoryInput): void => {
		this.parentId = entity.parentId
		this.title = entity.title
		this.body = entity.body
	}
}

export class MemoryRevisionFormDraft extends FormDraft<MemoryRevisionFormEntity, CreateMemoryRevisionInput, MemoryRevisionFormFields> {
	protected readonly rules = {
		expectedCurrentRevisionId: v.string(),
		title: memoryTitlePipe,
		body: memoryBodyPipe,
	}

	constructor() {
		super({ expectedCurrentRevisionId: '', title: '', body: '' })
		this.reserved = ['expectedCurrentRevisionId']
	}

	protected model = (): CreateMemoryRevisionInput => ({
		expectedCurrentRevisionId: this.expectedCurrentRevisionId,
		title: this.title,
		body: this.body,
	})

	protected load = (entity: MemoryRevisionFormEntity): void => {
		this.expectedCurrentRevisionId = entity.expectedCurrentRevisionId
		this.title = entity.title
		this.body = entity.body
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('MemoryCreationFormDraft', () => {
		it('models root Memories with raw title and body', () => {
			const draft = new MemoryCreationFormDraft(null)

			draft.title = '  Route Contracts  '
			draft.body = '  Body  '

			expect(draft.valid).toBe(true)
			expect(draft.toModel()).toEqual({ parentId: null, title: '  Route Contracts  ', body: '  Body  ' })
		})

		it('models child Memories with a parent id', () => {
			const draft = new MemoryCreationFormDraft('memory-parent')

			draft.title = 'Child'
			draft.body = ''

			expect(draft.toModel()).toEqual({ parentId: 'memory-parent', title: 'Child', body: '' })
		})

		it('resets title and body without clearing the parent id', () => {
			const draft = new MemoryCreationFormDraft('memory-parent')

			draft.title = 'Child'
			draft.body = 'Body'
			draft.reset()

			expect(draft.parentId).toBe('memory-parent')
			expect(draft.title).toBe('')
			expect(draft.body).toBe('')
		})

		it('rejects empty titles', () => {
			const draft = new MemoryCreationFormDraft(null).loadEntity({ parentId: null, title: 'Memory', body: '' })

			draft.title = ''

			expect(draft.valid).toBe(false)
			expect(draft.errors.title).toBe('Enter a Memory title')
		})
	})

	describe('MemoryRevisionFormDraft', () => {
		it('models revision saves with expected current revision id', () => {
			const draft = new MemoryRevisionFormDraft().loadEntity({
				expectedCurrentRevisionId: 'revision-current',
				title: ' Current ',
				body: ' Body ',
			})

			draft.title = ' Updated '

			expect(draft.dirty).toBe(true)
			expect(draft.toModel()).toEqual({ expectedCurrentRevisionId: 'revision-current', title: ' Updated ', body: ' Body ' })
		})

		it('tracks loaded content as clean until title or body changes', () => {
			const draft = new MemoryRevisionFormDraft().loadEntity({
				expectedCurrentRevisionId: 'revision-current',
				title: 'Current',
				body: 'Body',
			})

			expect(draft.dirty).toBe(false)
			draft.body = 'Changed'
			expect(draft.dirty).toBe(true)
			draft.reset()
			expect(draft.dirty).toBe(false)
			expect(draft.body).toBe('Body')
		})

		it('rejects empty revision titles', () => {
			const draft = new MemoryRevisionFormDraft().loadEntity({
				expectedCurrentRevisionId: 'revision-current',
				title: 'Current',
				body: 'Body',
			})

			draft.title = ''

			expect(draft.valid).toBe(false)
			expect(draft.errors.title).toBe('Enter a Memory title')
		})
	})
}
