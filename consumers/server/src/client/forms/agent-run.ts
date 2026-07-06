import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { SendAgentRunMessageInput } from '../composables/core/server-api'

type AgentRunMessageFormFields = {
	text: string
}

const messageTextPipe = v.string().pipe(v.custom((value) => value.trim().length > 0, 'Enter a message'))

export class AgentRunMessageFormDraft extends FormDraft<SendAgentRunMessageInput, SendAgentRunMessageInput, AgentRunMessageFormFields> {
	protected readonly rules = {
		text: messageTextPipe,
	}

	constructor() {
		super({ text: '' })
	}

	clear(): void {
		this.loadEntity({ parts: [{ type: 'text', text: '', metadata: null }] })
	}

	protected model = (): SendAgentRunMessageInput => ({ parts: [{ type: 'text', text: this.text.trim(), metadata: null }] })

	protected load = (entity: SendAgentRunMessageInput): void => {
		this.text = entity.parts.at(0)?.text ?? ''
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('AgentRunMessageFormDraft', () => {
		it('trims submitted message text', () => {
			const draft = new AgentRunMessageFormDraft()

			draft.text = '  Please continue planning.  '

			expect(draft.toModel()).toEqual({ parts: [{ type: 'text', text: 'Please continue planning.', metadata: null }] })
		})

		it('rejects whitespace-only message text', () => {
			const draft = new AgentRunMessageFormDraft()

			draft.text = '   '

			expect(draft.valid).toBe(false)
			expect(draft.errors.text).toBe('Enter a message')
		})
	})
}
