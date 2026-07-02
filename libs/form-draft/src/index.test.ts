import { v } from 'valleyed'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { FormDraft, FormDraftMultiSelect, FormDraftSelect, formDraftPipe } from './index'

type NameFields = { name: string }
type NameModel = { name: string }

class NameFormDraft extends FormDraft<NameModel, NameModel, NameFields> {
	protected readonly rules = {
		name: v.string().pipe(v.min<string>(1, 'Name is required')),
	}

	constructor(initialName = '') {
		super({ name: initialName })
	}

	protected model = (): NameModel => ({ name: this.name })

	protected load = (entity: NameModel): void => {
		this.name = entity.name
	}
}

type ParentFields = { child: NameFormDraft; label: string }
type ParentModel = { child: NameModel; label: string }

class ParentFormDraft extends FormDraft<ParentModel, ParentModel, ParentFields> {
	protected readonly rules = {
		child: formDraftPipe<NameFormDraft>(),
		label: v.string().pipe(v.min<string>(1, 'Label is required')),
	}

	constructor() {
		super({ child: new NameFormDraft('child'), label: 'parent' })
	}

	protected model = (): ParentModel => ({ child: this.child.toModel(), label: this.label })

	protected load = (entity: ParentModel): void => {
		this.child.loadEntity(entity.child)
		this.label = entity.label
	}
}

describe('FormDraft', () => {
	it('validates initial values after the initialization tick', async () => {
		const invalidFactory = new NameFormDraft()
		const validFactory = new NameFormDraft('Gorchestra')

		await nextTick()

		expect(invalidFactory.valid).toBe(false)
		expect(validFactory.valid).toBe(true)
	})

	it('validates field values without transforming visible input', () => {
		const factory = new NameFormDraft()

		factory.name = '  Gorchestra  '

		expect(factory.name).toBe('  Gorchestra  ')
		expect(factory.toModel()).toEqual({ name: '  Gorchestra  ' })
	})

	it('exposes field errors for invalid changed values', () => {
		const factory = new NameFormDraft('Gorchestra')

		factory.name = ''

		expect(factory.valid).toBe(false)
		expect(factory.errors.name).toBe('Name is required')
	})

	it('tracks dirty state per field and resets to originals', () => {
		const factory = new NameFormDraft('Gorchestra')

		expect(factory.isDirty('name')).toBe(false)

		factory.name = 'Changed'
		expect(factory.dirty).toBe(true)
		expect(factory.isDirty('name')).toBe(true)

		factory.reset()

		expect(factory.name).toBe('Gorchestra')
		expect(factory.dirty).toBe(false)
		expect(factory.isDirty('name')).toBe(false)
	})

	it('loads entities as clean originals', () => {
		const factory = new NameFormDraft()

		factory.loadEntity({ name: '  Loaded  ' })

		expect(factory.name).toBe('  Loaded  ')
		expect(factory.valid).toBe(true)
		expect(factory.dirty).toBe(false)
		expect(factory.toModel()).toEqual({ name: '  Loaded  ' })
	})

	it('throws a draft validation error from toModel when invalid', async () => {
		const factory = new NameFormDraft()

		await nextTick()

		expect(() => factory.toModel()).toThrow('Validation errors for name')
	})

	it('includes nested draft validity and dirty state', () => {
		const factory = new ParentFormDraft()

		expect(factory.valid).toBe(true)
		expect(factory.dirty).toBe(false)
		expect(factory.isDirty('child')).toBe(false)
		expect(factory.isDirty('label')).toBe(false)

		factory.child.name = ''

		expect(factory.valid).toBe(false)
		expect(factory.dirty).toBe(true)
		expect(factory.isDirty('child')).toBe(true)
		expect(factory.isDirty('label')).toBe(false)
	})

	it('flattens the first visible nested draft error into the parent field error', () => {
		const factory = new ParentFormDraft()

		factory.child.name = ''

		expect(factory.valid).toBe(false)
		expect(factory.child.errors.name).toBe('Name is required')
		expect(factory.errors.child).toBe('Name is required')
	})

	it('loads and resets nested factories as clean originals', () => {
		const factory = new ParentFormDraft()

		factory.loadEntity({ child: { name: 'Loaded child' }, label: 'Loaded parent' })
		factory.child.name = 'Changed child'
		factory.label = 'Changed parent'

		expect(factory.dirty).toBe(true)

		factory.reset()

		expect(factory.dirty).toBe(false)
		expect(factory.toModel()).toEqual({ child: { name: 'Loaded child' }, label: 'Loaded parent' })
	})
})

describe('FormDraftSelect', () => {
	it('loads, resets, and models a single selected value', () => {
		const draft = new FormDraftSelect<string | null>({ initialValue: null })

		draft.loadEntity('model-1')
		expect(draft.value).toBe('model-1')
		expect(draft.dirty).toBe(false)
		expect(draft.toModel()).toBe('model-1')

		draft.value = 'model-2'
		expect(draft.dirty).toBe(true)

		draft.reset()
		expect(draft.value).toBe('model-1')
		expect(draft.dirty).toBe(false)
	})

	it('skips option membership validation while options are unknown', () => {
		const draft = new FormDraftSelect<string>({ initialValue: 'model-stale' })

		draft.clearOptions()

		expect(draft.valid).toBe(true)
		expect(draft.errors.value).toBe('')
	})

	it('shows loaded-option membership errors immediately for pristine values', () => {
		const draft = new FormDraftSelect<string>({ initialValue: 'model-stale' })

		draft.loadEntity('model-stale')
		draft.setOptions(['model-1'])

		expect(draft.dirty).toBe(false)
		expect(draft.valid).toBe(false)
		expect(draft.errors.value).toBe('Selected option is unavailable')
	})

	it('uses differ equality when checking loaded options', () => {
		const draft = new FormDraftSelect<{ id: string }>({ initialValue: { id: 'model-1' } })

		draft.setOptions([{ id: 'model-1' }])

		expect(draft.valid).toBe(true)
	})

	it('keeps caller pipe errors dirty-gated', async () => {
		const pristineInvalidDraft = new FormDraftSelect<string | null>({
			initialValue: null,
			pipe: (base) => base.pipe(v.custom((value) => value !== null, 'Select an option')),
		})
		const changedInvalidDraft = new FormDraftSelect<string | null>({
			initialValue: 'model-1',
			pipe: (base) => base.pipe(v.custom((value) => value !== null, 'Select an option')),
		})

		await nextTick()
		expect(pristineInvalidDraft.valid).toBe(false)
		expect(pristineInvalidDraft.errors.value).toBe('')

		changedInvalidDraft.value = null

		expect(changedInvalidDraft.valid).toBe(false)
		expect(changedInvalidDraft.errors.value).toBe('Select an option')
	})
})

describe('FormDraftMultiSelect', () => {
	it('loads, resets, and models selected values', () => {
		const draft = new FormDraftMultiSelect<string>({ initialValue: [] })

		draft.loadEntity(['model-1'])
		expect(draft.value).toEqual(['model-1'])
		expect(draft.dirty).toBe(false)
		expect(draft.toModel()).toEqual(['model-1'])

		draft.value = ['model-1', 'model-2']
		expect(draft.dirty).toBe(true)

		draft.reset()
		expect(draft.value).toEqual(['model-1'])
		expect(draft.dirty).toBe(false)
	})

	it('validates every selected value against loaded options', () => {
		const draft = new FormDraftMultiSelect<string>({ initialValue: ['model-1', 'model-stale'] })

		draft.setOptions(['model-1'])

		expect(draft.valid).toBe(false)
		expect(draft.errors.value).toBe('One or more selected options are unavailable')
	})

	it('supports required multi-select validation through the caller pipe', async () => {
		const draft = new FormDraftMultiSelect<string>({
			initialValue: [],
			pipe: (base) => base.pipe(v.custom((value) => value.length > 0, 'Select at least one option')),
		})
		const changedInvalidDraft = new FormDraftMultiSelect<string>({
			initialValue: ['model-1'],
			pipe: (base) => base.pipe(v.custom((value) => value.length > 0, 'Select at least one option')),
		})

		await nextTick()
		expect(draft.valid).toBe(false)
		expect(draft.errors.value).toBe('')

		changedInvalidDraft.value = []

		expect(changedInvalidDraft.errors.value).toBe('Select at least one option')
	})
})

describe('FormDraftArray', () => {
	it('adds, deletes, iterates, validates, and models child drafts', async () => {
		const factories = FormDraft.asArray(() => new NameFormDraft())

		expect(factories.valid).toBe(true)
		expect(factories.dirty).toBe(false)

		const first = factories.add()
		await nextTick()
		expect(factories.length).toBe(1)
		expect(factories.valid).toBe(false)
		expect(factories.dirty).toBe(true)

		first.name = 'Project'

		expect(factories.valid).toBe(true)
		expect([...factories].map((factory) => factory.name)).toEqual(['Project'])
		expect(factories.toModel()).toEqual([{ name: 'Project' }])

		factories.delete(0)

		expect(factories.length).toBe(0)
		expect(factories.valid).toBe(true)
		expect(factories.toModel()).toEqual([])
	})

	it('loads arrays as clean originals and resets to the loaded entities', () => {
		const factories = FormDraft.asArray(() => new NameFormDraft())

		factories.loadEntity([{ name: 'One' }, { name: 'Two' }])

		expect(factories.length).toBe(2)
		expect(factories.valid).toBe(true)
		expect(factories.dirty).toBe(false)
		expect(factories.isDirty()).toBe(false)
		expect(factories.toModel()).toEqual([{ name: 'One' }, { name: 'Two' }])

		factories.add().name = 'Three'
		expect(factories.dirty).toBe(true)
		expect(factories.isDirty()).toBe(true)

		factories.reset()

		expect(factories.length).toBe(2)
		expect(factories.dirty).toBe(false)
		expect(factories.isDirty()).toBe(false)
		expect(factories.toModel()).toEqual([{ name: 'One' }, { name: 'Two' }])
	})
})
