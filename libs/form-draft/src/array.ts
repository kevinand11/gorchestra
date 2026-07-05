import { differ } from 'valleyed'
import { markRaw, toRaw } from 'vue'

import { FormDraft } from './form-draft'
import { attachNestedFormDraftMetadata } from './nested'
import type { FormDraftLike, InferEntity, InferFields, InferModel } from './types'
import { copy, deepToRaw, makeReactive } from './utils'

export class FormDraftArray<T extends FormDraftLike> extends FormDraft<InferEntity<T>[], InferModel<T>[], object> {
	readonly rules = {}
	#children = makeReactive({ value: [] as T[] })
	#lastLoadedEntities: InferEntity<T>[] = []

	constructor(private readonly factory: () => T) {
		super({})
	}

	*[Symbol.iterator](): Generator<T> {
		for (const child of this.#children.value) yield child
	}

	load = (entities: InferEntity<T>[]): void => {
		this.#children.value = entities.map((entity) => {
			const instance = this.make()
			instance.loadEntity(entity)
			return instance
		})
		this.#lastLoadedEntities = copy(entities)
	}

	model = (): InferModel<T>[] => this.childModels()

	override get listenerValue(): InferFields<T>[] {
		return attachNestedFormDraftMetadata(
			this.#children.value.map((instance) => instance.listenerValue as InferFields<T>),
			this,
		)
	}

	override reset(): void {
		this.#children.value = this.#lastLoadedEntities.map((entity) => {
			const instance = this.make()
			instance.loadEntity(entity)
			return instance
		})
		this.broadcast()
	}

	override get firstError(): string {
		return this.#children.value.map((instance) => instance.firstError).find((error) => error.length > 0) ?? ''
	}

	override get valid(): boolean {
		return this.#children.value.every((instance) => instance.valid)
	}

	override get dirty(): boolean {
		return this.isDirty()
	}

	override isDirty(): boolean {
		if (this.#children.value.some((instance) => toRaw(instance).dirty)) return true
		return !differ.equal(deepToRaw(this.#lastLoadedEntities), this.childModels())
	}

	add(at = this.#children.value.length): T {
		const instance = this.make()
		this.#children.value = [...this.#children.value.slice(0, at), instance, ...this.#children.value.slice(at)]
		this.broadcast()
		return instance
	}

	delete(at: number): void {
		this.#children.value = this.#children.value.filter((_, index) => index !== at)
		this.broadcast()
	}

	get length(): number {
		return this.#children.value.length
	}

	private make(): T {
		const instance = markRaw(this.factory())
		instance.listen(() => this.broadcast())
		return instance
	}

	private childModels(): InferModel<T>[] {
		return this.#children.value.map((instance) => deepToRaw((instance as unknown as { model: () => InferModel<T> }).model()))
	}
}
