import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type DisplayNameFormFields = {
	displayName: string
}

type DisplayNameFormModel = {
	displayName: string
}

const displayNamePipe = v.string().pipe(v.min<string>(1, 'Enter a display name'))

abstract class DisplayNameFormDraft extends FormDraft<DisplayNameFormModel, DisplayNameFormModel, DisplayNameFormFields> {
	protected readonly rules = { displayName: displayNamePipe }

	constructor() {
		super({ displayName: '' })
		this.revalidate()
	}

	protected model = (): DisplayNameFormModel => ({ displayName: this.displayName })

	protected load = (entity: DisplayNameFormModel): void => {
		this.displayName = entity.displayName
	}
}

export class WorkspaceCreationFormDraft extends DisplayNameFormDraft {}

export class PortfolioCreationFormDraft extends DisplayNameFormDraft {}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('WorkspaceCreationFormDraft', () => {
		it('starts invalid with an empty display name', () => {
			const draft = new WorkspaceCreationFormDraft()

			expect(draft.valid).toBe(false)
			expect(draft.errors.displayName).toBe('')
		})

		it('models the visible display name without transforming it', () => {
			const draft = new WorkspaceCreationFormDraft()

			draft.displayName = '  Delivery Ops  '

			expect(draft.toModel()).toEqual({ displayName: '  Delivery Ops  ' })
		})
	})

	describe('PortfolioCreationFormDraft', () => {
		it('starts invalid with an empty display name', () => {
			const draft = new PortfolioCreationFormDraft()

			expect(draft.valid).toBe(false)
			expect(draft.errors.displayName).toBe('')
		})

		it('models the visible display name without transforming it', () => {
			const draft = new PortfolioCreationFormDraft()

			draft.displayName = '  Main Portfolio  '

			expect(draft.toModel()).toEqual({ displayName: '  Main Portfolio  ' })
		})
	})
}
