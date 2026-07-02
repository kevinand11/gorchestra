import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type ProvisionWorkspaceFormFields = {
	workspaceDisplayName: string
	portfolioDisplayName: string
}

type ProvisionWorkspaceFormModel = {
	workspaceDisplayName: string
	portfolioDisplayName: string
}

const displayNamePipe = v.string().pipe(v.min<string>(1, 'Enter a display name'))

export class ProvisionWorkspaceFormDraft extends FormDraft<
	ProvisionWorkspaceFormModel,
	ProvisionWorkspaceFormModel,
	ProvisionWorkspaceFormFields
> {
	protected readonly rules = {
		workspaceDisplayName: displayNamePipe,
		portfolioDisplayName: displayNamePipe,
	}

	constructor() {
		super({ workspaceDisplayName: 'Delivery Ops', portfolioDisplayName: 'Main Portfolio' })
	}

	protected model = (): ProvisionWorkspaceFormModel => ({
		workspaceDisplayName: this.workspaceDisplayName,
		portfolioDisplayName: this.portfolioDisplayName,
	})

	protected load = (entity: ProvisionWorkspaceFormModel): void => {
		this.workspaceDisplayName = entity.workspaceDisplayName
		this.portfolioDisplayName = entity.portfolioDisplayName
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ProvisionWorkspaceFormDraft', () => {
		it('starts valid with default display names', () => {
			const factory = new ProvisionWorkspaceFormDraft()

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ workspaceDisplayName: 'Delivery Ops', portfolioDisplayName: 'Main Portfolio' })
		})

		it('models display names without transforming visible fields', () => {
			const factory = new ProvisionWorkspaceFormDraft()

			factory.workspaceDisplayName = '  Team Ops  '
			factory.portfolioDisplayName = '  Launch Portfolio  '

			expect(factory.toModel()).toEqual({ workspaceDisplayName: '  Team Ops  ', portfolioDisplayName: '  Launch Portfolio  ' })
		})

		it('rejects empty display names', () => {
			const factory = new ProvisionWorkspaceFormDraft()

			factory.workspaceDisplayName = ''
			factory.portfolioDisplayName = ''

			expect(factory.valid).toBe(false)
			expect(factory.errors.workspaceDisplayName).toBe('Enter a display name')
			expect(factory.errors.portfolioDisplayName).toBe('Enter a display name')
		})
	})
}
