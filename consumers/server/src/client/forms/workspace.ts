import { v } from 'valleyed'

import { BaseFactory } from './factory'

type ProvisionWorkspaceFormFields = {
	workspaceDisplayName: string
	portfolioDisplayName: string
}

type ProvisionWorkspaceFormModel = {
	workspaceDisplayName: string
	portfolioDisplayName: string
}

const displayNamePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a display name'))

export class ProvisionWorkspaceFormFactory extends BaseFactory<
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
		this.initialize()
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

	describe('ProvisionWorkspaceFormFactory', () => {
		it('starts valid with default display names', () => {
			const factory = new ProvisionWorkspaceFormFactory()

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ workspaceDisplayName: 'Delivery Ops', portfolioDisplayName: 'Main Portfolio' })
		})

		it('trims display names in the model', () => {
			const factory = new ProvisionWorkspaceFormFactory()

			factory.workspaceDisplayName = '  Team Ops  '
			factory.portfolioDisplayName = '  Launch Portfolio  '

			expect(factory.toModel()).toEqual({ workspaceDisplayName: 'Team Ops', portfolioDisplayName: 'Launch Portfolio' })
		})

		it('rejects empty display names', () => {
			const factory = new ProvisionWorkspaceFormFactory()

			factory.workspaceDisplayName = '  '
			factory.portfolioDisplayName = ''

			expect(factory.valid).toBe(false)
			expect(factory.errors.workspaceDisplayName).toBe('Enter a display name')
			expect(factory.errors.portfolioDisplayName).toBe('Enter a display name')
		})
	})
}
