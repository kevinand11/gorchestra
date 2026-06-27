import { v } from 'valleyed'

import { BaseFactory } from './factory'
import type { CreateLinkInput } from '../composables/useServerApi'

type MemoryLinkCreationType = CreateLinkInput['type']

type MemoryLinkCreationFormFields = {
	linkType: MemoryLinkCreationType | ''
	targetMemoryId: string
}

type MemoryLinkCreationFormOptions = {
	sourceMemoryId: string
	eligibleTargetIds?: string[]
}

export const memoryLinkCreationTypeOptions = [
	{ value: 'references', label: 'References' },
	{ value: 'supports', label: 'Supports' },
	{ value: 'contradicts', label: 'Contradicts' },
	{ value: 'supersedes', label: 'Supersedes' },
] as const

const linkTypePipe = v.in(['references', 'supports', 'contradicts', 'supersedes'], 'Select a Link Type')

export class MemoryLinkCreationFormFactory extends BaseFactory<CreateLinkInput, CreateLinkInput, MemoryLinkCreationFormFields> {
	#sourceMemoryId = ''
	#eligibleTargetIds = new Set<string>()
	protected readonly rules: {
		linkType: typeof linkTypePipe
		targetMemoryId: ReturnType<typeof targetMemoryIdPipe>
	}

	constructor({ sourceMemoryId, eligibleTargetIds = [] }: MemoryLinkCreationFormOptions) {
		super({ linkType: '', targetMemoryId: '' })
		this.#sourceMemoryId = normalizeId(sourceMemoryId)
		this.#eligibleTargetIds = new Set(eligibleTargetIds.map(normalizeId).filter(isNonEmpty))
		this.rules = {
			linkType: linkTypePipe,
			targetMemoryId: targetMemoryIdPipe(
				() => this.#sourceMemoryId,
				() => this.#eligibleTargetIds,
			),
		}
		this.initialize()
	}

	setSourceMemoryId(sourceMemoryId: string): void {
		this.#sourceMemoryId = normalizeId(sourceMemoryId)
		this.revalidateTargetMemoryId()
	}

	setEligibleTargetIds(eligibleTargetIds: string[]): void {
		this.#eligibleTargetIds = new Set(eligibleTargetIds.map(normalizeId).filter(isNonEmpty))
		this.revalidateTargetMemoryId()
	}

	resetTarget(): void {
		this.targetMemoryId = ''
	}

	protected model = (): CreateLinkInput => ({
		type: this.linkType as MemoryLinkCreationType,
		from: { type: 'memory', id: this.#sourceMemoryId },
		to: { type: 'memory', id: this.targetMemoryId },
	})

	protected load = (entity: CreateLinkInput): void => {
		this.linkType = entity.type
		this.#sourceMemoryId = entity.from.id
		this.targetMemoryId = entity.to.id
	}

	private revalidateTargetMemoryId(): void {
		this.set('targetMemoryId', this.targetMemoryId)
	}
}

function targetMemoryIdPipe(sourceMemoryId: () => string, eligibleTargetIds: () => Set<string>) {
	return v
		.string()
		.pipe(v.asTrimmed(), v.min<string>(1, 'Select a target Memory'))
		.pipe(v.custom<string>((value) => value !== sourceMemoryId(), 'Select a different Memory'))
		.pipe(v.custom<string>((value) => eligibleTargetIds().has(value), 'Select an available target Memory'))
}

function normalizeId(id: string): string {
	return id.trim()
}

function isNonEmpty(value: string): boolean {
	return value.length > 0
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('MemoryLinkCreationFormFactory', () => {
		it('models outgoing Memory Links with trimmed target ids', () => {
			const factory = new MemoryLinkCreationFormFactory({ sourceMemoryId: 'memory-1', eligibleTargetIds: ['memory-2'] })

			factory.linkType = 'supports'
			factory.targetMemoryId = ' memory-2 '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				type: 'supports',
				from: { type: 'memory', id: 'memory-1' },
				to: { type: 'memory', id: 'memory-2' },
			})
		})

		it('requires an explicit Link Type and target Memory', () => {
			const factory = new MemoryLinkCreationFormFactory({ sourceMemoryId: 'memory-1', eligibleTargetIds: ['memory-2'] })

			factory.linkType = ''
			factory.targetMemoryId = ''

			expect(factory.valid).toBe(false)
			expect(factory.errors.linkType).toBe('')
			expect(factory.errors.targetMemoryId).toBe('')
		})

		it('rejects self-links before submit', () => {
			const factory = new MemoryLinkCreationFormFactory({ sourceMemoryId: 'memory-1', eligibleTargetIds: ['memory-1', 'memory-2'] })

			factory.linkType = 'references'
			factory.targetMemoryId = 'memory-1'

			expect(factory.valid).toBe(false)
			expect(factory.errors.targetMemoryId).toBe('Select a different Memory')
		})

		it('rejects targets outside the current eligible target ids', () => {
			const factory = new MemoryLinkCreationFormFactory({ sourceMemoryId: 'memory-1', eligibleTargetIds: ['memory-2'] })

			factory.linkType = 'contradicts'
			factory.targetMemoryId = 'memory-3'

			expect(factory.valid).toBe(false)
			expect(factory.errors.targetMemoryId).toBe('Select an available target Memory')
		})

		it('revalidates target Memory ids when eligibility changes', () => {
			const factory = new MemoryLinkCreationFormFactory({ sourceMemoryId: 'memory-1', eligibleTargetIds: ['memory-2'] })

			factory.linkType = 'supersedes'
			factory.targetMemoryId = 'memory-2'
			expect(factory.valid).toBe(true)

			factory.setEligibleTargetIds(['memory-3'])

			expect(factory.valid).toBe(false)
			expect(factory.errors.targetMemoryId).toBe('Select an available target Memory')
		})
	})
}
