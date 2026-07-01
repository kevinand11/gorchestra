import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

type PlanCreationFormFields = {
	title: string
	initialMessage: string
	planningModelId: string
}

type PlanCreationFormModel = {
	title: string
	initialMessage: string
	config: { model: { planningModelId: string | null } | null }
}

const planTitlePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a Plan title'))
const initialMessagePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter an initial planning message'))
const optionalModelIdPipe = v.string().pipe(v.asTrimmed())

export class PlanCreationFormDraft extends FormDraft<PlanCreationFormModel, PlanCreationFormModel, PlanCreationFormFields> {
	protected readonly rules = {
		title: planTitlePipe,
		initialMessage: initialMessagePipe,
		planningModelId: optionalModelIdPipe,
	}

	constructor() {
		super({ title: '', initialMessage: '', planningModelId: '' })
	}

	protected model = (): PlanCreationFormModel => ({
		title: this.title,
		initialMessage: this.initialMessage,
		config: { model: { planningModelId: nullableId(this.planningModelId) } },
	})

	protected load = (entity: PlanCreationFormModel): void => {
		this.title = entity.title
		this.initialMessage = entity.initialMessage
		this.planningModelId = entity.config.model?.planningModelId ?? ''
	}
}

function nullableId(value: string): string | null {
	const trimmed = value.trim()
	return trimmed.length === 0 ? null : trimmed
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('PlanCreationFormDraft', () => {
		it('trims and models valid Plan creation input', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = '  Repository setup plan  '
			factory.initialMessage = '  Please plan repository onboarding.  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				title: 'Repository setup plan',
				initialMessage: 'Please plan repository onboarding.',
				config: { model: { planningModelId: null } },
			})
		})

		it('models explicit Planning Model overrides', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = 'Plan'
			factory.initialMessage = 'Plan this.'
			factory.planningModelId = ' model-1 '

			expect(factory.toModel()).toEqual({
				title: 'Plan',
				initialMessage: 'Plan this.',
				config: { model: { planningModelId: 'model-1' } },
			})
		})

		it('rejects empty Plan creation input', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = '  '
			factory.initialMessage = '  '

			expect(factory.valid).toBe(false)
			expect(factory.errors.title).toBe('Enter a Plan title')
			expect(factory.errors.initialMessage).toBe('Enter an initial planning message')
		})
	})
}
