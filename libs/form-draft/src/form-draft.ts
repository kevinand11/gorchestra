import { differ, v } from 'valleyed'
import { nextTick } from 'vue'

import type { FormDraftArray } from './array'
import { LocalDataClass } from './data-class'
import type { FlatKeys, FormDraftLike, FormDraftRules, InferFields } from './types'
import { copy, createInitialValidities, deepToRaw, firstErrorMessage, firstNonEmptyError, makeReactive } from './utils'

type ValidationResult = ReturnType<typeof v.validate>
type InvalidValidationResult = Extract<ValidationResult, { valid: false }>
type FormDraftArrayFactory = <T extends FormDraftLike>(factory: () => T) => FormDraftArray<T>

let formDraftArrayFactory: FormDraftArrayFactory | null = null

class FormDraftValidationError extends Error {
	constructor(draftName: string) {
		super(`Validation errors for ${draftName}`)
		this.name = 'FormDraftValidationError'
	}
}

export function setFormDraftArrayFactory(factory: FormDraftArrayFactory): void {
	formDraftArrayFactory = factory
}

export abstract class FormDraft<Entity, Model, Fields extends object> extends LocalDataClass<Fields> {
	#listeners: (() => void)[] = []
	#embeds: Partial<Record<keyof Fields, FormDraftLike>>
	readonly #originals: Fields

	protected readonly values: Fields
	protected readonly validities: Record<keyof Fields, ValidationResult>
	protected abstract readonly rules: FormDraftRules<Fields>
	protected abstract model: () => Model
	protected abstract load: (entity: Entity) => void
	protected readonly onSet: { [Key in FlatKeys<Fields>]?: (value: Fields[Key]) => void } = {}
	protected reserved: string[] = []

	constructor(keys: Fields) {
		const allKeys = Object.keys(keys).reduce((acc, key) => ({ ...acc, [key]: true }), {} as Record<keyof Fields, true>)
		super(allKeys as Fields, {
			get: (key) => {
				if (key in this.#embeds) return this.#embeds[key] as Fields[typeof key]
				return this.values[key]
			},
			set: (key, value) => {
				if (key in this.#embeds) return
				this.set(key, value)
			},
		})

		const accumulated = Object.entries(keys).reduce(
			(acc, [key, value]) => {
				const typedKey = key as keyof Fields
				if (value instanceof FormDraft) {
					const child = value as FormDraftLike
					acc.embeds[typedKey] = child
					child.listen(() => this.set(typedKey, child.listenerValue as Fields[typeof typedKey]))
					acc.raw[typedKey] = child.listenerValue as Fields[typeof typedKey]
				} else {
					acc.raw[typedKey] = value as Fields[keyof Fields]
				}
				return acc
			},
			{
				embeds: {} as Partial<Record<keyof Fields, FormDraftLike>>,
				raw: {} as Fields,
			},
		)

		this.#embeds = accumulated.embeds
		this.#originals = makeReactive(copy(accumulated.raw))
		this.values = makeReactive(copy(accumulated.raw))
		this.validities = makeReactive(createInitialValidities(keys))
		void nextTick(() => this.validateInitialValues())
	}

	get valid(): boolean {
		return this.isValid(...(this.keys as (keyof Fields)[]))
	}

	get errors(): Record<keyof Fields, string> {
		return (Object.keys(this.validities) as (keyof Fields)[]).reduce(
			(acc, key) => {
				acc[key] = this.fieldError(key)
				return acc
			},
			{} as Record<keyof Fields, string>,
		)
	}

	get dirty(): boolean {
		return this.isDirty(...(this.keys as (keyof Fields)[]))
	}

	get firstError(): string {
		return firstNonEmptyError(this.errors)
	}

	private fieldError(key: keyof Fields): string {
		const child = this.#embeds[key]
		if (child !== undefined) return child.firstError

		const validity = this.visibleInvalidity(key)
		return validity === undefined ? '' : firstErrorMessage(validity)
	}

	private visibleInvalidity(key: keyof Fields): InvalidValidationResult | undefined {
		const validity = this.validities[key]
		if (validity.valid) return undefined
		return this.fieldIsDirty(key) ? validity : undefined
	}

	private fieldIsDirty(key: keyof Fields): boolean {
		return !differ.equal(this.#originals[key], this.values[key])
	}

	private isKeyDirty(key: keyof Fields): boolean {
		const child = this.#embeds[key]
		return child === undefined ? this.fieldIsDirty(key) : this.fieldOrChildIsDirty(key, child)
	}

	private fieldOrChildIsDirty(key: keyof Fields, child: FormDraftLike): boolean {
		return this.fieldIsDirty(key) || child.dirty
	}

	private isKeyValid(key: keyof Fields): boolean {
		const child = this.#embeds[key]
		return child === undefined ? this.fieldIsValid(key) : this.fieldAndChildAreValid(key, child)
	}

	private fieldAndChildAreValid(key: keyof Fields, child: FormDraftLike): boolean {
		if (!this.fieldIsValid(key)) return false
		return child.valid
	}

	private fieldIsValid(key: keyof Fields): boolean {
		return Boolean(this.validities[key]?.valid)
	}

	get watch() {
		return [this.validities, this.values]
	}

	set<Key extends keyof Fields>(key: Key, value: Fields[Key]): boolean {
		const check = v.validate(this.rules[key], deepToRaw(value))
		this.validities[key] = check
		const nextValue = (check.valid ? check.value : value) as Fields[Key]
		this.values[key] = nextValue
		const onSet = this.onSet[key as unknown as FlatKeys<Fields>] as ((value: Fields[Key]) => void) | undefined
		onSet?.(nextValue)
		this.broadcast()
		return check.valid
	}

	isValid(...keys: (keyof Fields)[]): boolean {
		return keys.every((key) => this.isKeyValid(key))
	}

	isValidExcept(...keys: (keyof Fields)[]): boolean {
		return this.isValid(...(this.keys as (keyof Fields)[]).filter((key) => !keys.includes(key)))
	}

	isDirty(...keys: (keyof Fields)[]): boolean {
		const keysToCheck = keys.length ? keys : (this.keys as (keyof Fields)[])
		return keysToCheck.some((key) => this.isKeyDirty(key))
	}

	isDirtyExcept(...keys: (keyof Fields)[]): boolean {
		return this.isDirty(...(this.keys as (keyof Fields)[]).filter((key) => !keys.includes(key)))
	}

	private validateInitialValues(): void {
		;(this.keys as (keyof Fields)[]).forEach((key) => this.set(key, this.values[key]))
	}

	reset(...keys: (keyof Fields)[]): void {
		const keysToReset = keys.length ? keys : (this.keys as (keyof Fields)[])
		const reserved = this.reserved as (keyof Fields)[]
		keysToReset
			.filter((key) => !reserved.includes(key))
			.forEach((key) => {
				this.#embeds[key]?.reset()
				this.set(key, this.#originals[key])
			})
	}

	loadEntity(entity: Entity): this {
		this.load(entity)
		const loadedKeys = this.keys as (keyof Fields)[]
		loadedKeys.forEach((key) => {
			this.#originals[key] = copy(this.values[key])
		})
		return this
	}

	toModel(): Model {
		if (!this.valid) throw new FormDraftValidationError(this.draftName)
		return deepToRaw(this.model())
	}

	get listenerValue(): Fields {
		return copy(this.values)
	}

	listen(callback: () => void): void {
		this.#listeners.push(callback)
	}

	protected broadcast(): void {
		this.#listeners.forEach((callback) => callback())
	}

	get flatKeys(): string[] {
		return Object.keys(this.#originals).filter((key) => !(key in this.#embeds))
	}

	get embedKeys(): (keyof Fields)[] {
		return Object.keys(this.#embeds) as (keyof Fields)[]
	}

	get keys(): string[] {
		return Object.keys(this.#originals)
	}

	private get draftName(): string {
		return this.constructor.name.toLowerCase().replace('formdraft', '').replace('draft', '')
	}

	static asArray<T extends FormDraftLike>(factory: () => T): FormDraftArray<T> {
		if (formDraftArrayFactory === null) throw new Error('FormDraftArray factory is not registered')
		return formDraftArrayFactory(factory)
	}
}

export const formDraftPipe = <T extends FormDraftLike>() => v.any<InferFields<T>>()
