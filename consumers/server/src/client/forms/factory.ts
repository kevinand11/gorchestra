import { differ, v, type Pipe } from 'valleyed'
import { isProxy, isReactive, isRef, markRaw, reactive, toRaw } from 'vue'

class FactoryValidationError extends Error {
	constructor(factoryName: string) {
		super(`Validation errors for ${factoryName}`)
		this.name = 'FactoryValidationError'
	}
}

function deepToRaw<T>(input: T): T {
	if (Array.isArray(input)) return deepArrayToRaw(input) as T
	if (isVueWrapped(input)) return deepToRaw(toRaw(input as object) as T)
	if (isPlainObject(input)) return deepObjectToRaw(input) as T
	return input
}

function deepArrayToRaw(input: unknown[]): unknown[] {
	return input.map((item) => deepToRaw(item))
}

function deepObjectToRaw(input: Record<string, unknown>): Record<string, unknown> {
	return Object.entries(input).reduce<Record<string, unknown>>((acc, [key, value]) => {
		acc[key] = deepToRaw(value)
		return acc
	}, {})
}

function isVueWrapped(input: unknown): boolean {
	return isRef(input) || isReactive(input) || isProxy(input)
}

type Accessor<Keys extends object> = {
	get: <Key extends keyof Keys>(key: Key, keys: Keys) => Keys[Key]
	set: <Key extends keyof Keys>(key: Key, value: Keys[Key], keys: Keys) => void
}

function wrapWithProperties(): { new <Keys extends object>(): Keys } {
	return class {} as unknown as { new <Keys extends object>(): Keys }
}

// @ts-expect-error Generic runtime property wrapper intentionally gives factory instances typed field access.
class LocalDataClass<Keys extends object> extends wrapWithProperties()<Keys> {
	constructor(keys: Keys, access: Accessor<Keys>) {
		super()
		Object.keys(keys).forEach((key) => {
			const typedKey = key as keyof Keys
			Object.defineProperty(this, key, {
				get: () => access.get(typedKey, keys),
				set: (value: Keys[typeof typedKey]) => access.set(typedKey, value, keys),
				enumerable: true,
				configurable: true,
			})
		})
	}
}

type FactoryLike<Entity = unknown, Model = unknown, Fields = unknown> = {
	readonly dirty: boolean
	readonly listenerValue: Fields
	readonly valid: boolean
	listen(callback: () => void): void
	loadEntity(entity: Entity): unknown
	reset(): void
	toModel(): Model
}

type FlatKeys<K extends object> = keyof {
	[Key in keyof K as K[Key] extends FactoryLike ? never : Key]: boolean
}

type InferEntity<T> = T extends FactoryLike<infer Entity, unknown, unknown> ? Entity : never
type InferModel<T> = T extends FactoryLike<unknown, infer Model, unknown> ? Model : never
type InferFields<T> = T extends FactoryLike<unknown, unknown, infer Fields> ? Fields : never
type ValidationResult = ReturnType<typeof v.validate>
type InvalidValidationResult = Extract<ValidationResult, { valid: false }>
type FactoryRules<K extends object> = { [Key in keyof K]: Pipe<unknown, unknown> }

export abstract class BaseFactory<Entity, Model, Fields extends object> extends LocalDataClass<Fields> {
	#listeners: (() => void)[] = []
	#embeds: Partial<Record<keyof Fields, FactoryLike>>
	readonly #originals: Fields

	protected readonly values: Fields
	protected readonly validities: Record<keyof Fields, ValidationResult>
	protected abstract readonly rules: FactoryRules<Fields>
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
				if (value instanceof BaseFactory) {
					const child = value as FactoryLike<unknown, unknown, Fields[keyof Fields]>
					acc.embeds[typedKey] = child
					child.listen(() => this.set(typedKey, child.listenerValue))
					acc.raw[typedKey] = child.listenerValue
				} else {
					acc.raw[typedKey] = value as Fields[keyof Fields]
				}
				return acc
			},
			{
				embeds: {} as Partial<Record<keyof Fields, FactoryLike>>,
				raw: {} as Fields,
			},
		)

		this.#embeds = accumulated.embeds
		this.#originals = makeReactive(copy(accumulated.raw))
		this.values = makeReactive(copy(accumulated.raw))
		this.validities = makeReactive(createInitialValidities(keys))
	}

	protected initialize(): void {
		this.reset()
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
		return (
			this.embedKeys.some((key) => this.#embeds[key]?.dirty) ||
			this.flatKeys.some((key) => !differ.equal(this.#originals[key as keyof Fields], this.values[key as keyof Fields]))
		)
	}

	private fieldError(key: keyof Fields): string {
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

	private isKeyValid(key: keyof Fields): boolean {
		const child = this.#embeds[key]
		return child === undefined ? this.fieldIsValid(key) : this.fieldAndChildAreValid(key, child)
	}

	private fieldAndChildAreValid(key: keyof Fields, child: FactoryLike): boolean {
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
		if (!this.valid) throw new FactoryValidationError(this.factoryName)
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

	private get factoryName(): string {
		return this.constructor.name.toLowerCase().replace('factory', '')
	}

	static asArray<T extends FactoryLike>(factory: () => T): FactoryArray<T> {
		return new FactoryArray(factory)
	}
}

export class FactoryArray<T extends FactoryLike> extends BaseFactory<InferEntity<T>[], InferModel<T>[], object> {
	readonly rules = {}
	#children = makeReactive({ value: [] as T[] })
	#lastLoadedEntities: InferEntity<T>[] = []

	constructor(private readonly factory: () => T) {
		super({})
		this.initialize()
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
		return this.#children.value.map((instance) => instance.listenerValue as InferFields<T>)
	}

	override reset(): void {
		this.#children.value = this.#lastLoadedEntities.map((entity) => {
			const instance = this.make()
			instance.loadEntity(entity)
			return instance
		})
		this.broadcast()
	}

	override get valid(): boolean {
		return this.#children.value.every((instance) => instance.valid)
	}

	override get dirty(): boolean {
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

export const factoryPipe = <T extends FactoryLike>() => v.any<InferFields<T>>()

function createInitialValidities<Fields extends object>(fields: Fields): Record<keyof Fields, ValidationResult> {
	return Object.keys(fields).reduce(
		(acc, key) => ({ ...acc, [key]: { valid: true, value: undefined } }),
		{} as Record<keyof Fields, ValidationResult>,
	)
}

function copy<T>(input: T): T {
	return structuredClone(deepToRaw(input))
}

function makeReactive<T extends object>(input: T): T {
	return reactive(input) as T
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
	return input?.constructor?.name === 'Object'
}

function firstErrorMessage(validity: InvalidValidationResult): string {
	return validity.error.messages.at(0)?.message ?? ''
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	type NameFields = { name: string }
	type NameModel = { name: string }

	class NameFactory extends BaseFactory<NameModel, NameModel, NameFields> {
		protected readonly rules = {
			name: v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Name is required')),
		}

		constructor(initialName = '') {
			super({ name: initialName })
			this.initialize()
		}

		protected model = (): NameModel => ({ name: this.name })

		protected load = (entity: NameModel): void => {
			this.name = entity.name
		}
	}

	type ParentFields = { child: NameFactory; label: string }
	type ParentModel = { child: NameModel; label: string }

	class ParentFactory extends BaseFactory<ParentModel, ParentModel, ParentFields> {
		protected readonly rules = {
			child: factoryPipe<NameFactory>(),
			label: v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Label is required')),
		}

		constructor() {
			super({ child: new NameFactory('child'), label: 'parent' })
			this.initialize()
		}

		protected model = (): ParentModel => ({ child: this.child.toModel(), label: this.label })

		protected load = (entity: ParentModel): void => {
			this.child.loadEntity(entity.child)
			this.label = entity.label
		}
	}

	describe('BaseFactory', () => {
		it('validates initial values immediately', () => {
			const invalidFactory = new NameFactory()
			const validFactory = new NameFactory('Gorchestra')

			expect(invalidFactory.valid).toBe(false)
			expect(validFactory.valid).toBe(true)
		})

		it('sanitizes valid field values through Valleyed pipes', () => {
			const factory = new NameFactory()

			factory.name = '  Gorchestra  '

			expect(factory.name).toBe('Gorchestra')
			expect(factory.toModel()).toEqual({ name: 'Gorchestra' })
		})

		it('exposes field errors for invalid changed values', () => {
			const factory = new NameFactory('Gorchestra')

			factory.name = '   '

			expect(factory.valid).toBe(false)
			expect(factory.errors.name).toBe('Name is required')
		})

		it('tracks dirty state and resets to originals', () => {
			const factory = new NameFactory('Gorchestra')

			factory.name = 'Changed'
			expect(factory.dirty).toBe(true)

			factory.reset()

			expect(factory.name).toBe('Gorchestra')
			expect(factory.dirty).toBe(false)
		})

		it('loads entities as clean originals', () => {
			const factory = new NameFactory()

			factory.loadEntity({ name: '  Loaded  ' })

			expect(factory.name).toBe('Loaded')
			expect(factory.valid).toBe(true)
			expect(factory.dirty).toBe(false)
			expect(factory.toModel()).toEqual({ name: 'Loaded' })
		})

		it('throws a factory validation error from toModel when invalid', () => {
			const factory = new NameFactory()

			expect(() => factory.toModel()).toThrow('Validation errors for name')
		})

		it('includes nested factory validity and dirty state', () => {
			const factory = new ParentFactory()

			expect(factory.valid).toBe(true)
			expect(factory.dirty).toBe(false)

			factory.child.name = '   '

			expect(factory.valid).toBe(false)
			expect(factory.dirty).toBe(true)
		})

		it('loads and resets nested factories as clean originals', () => {
			const factory = new ParentFactory()

			factory.loadEntity({ child: { name: 'Loaded child' }, label: 'Loaded parent' })
			factory.child.name = 'Changed child'
			factory.label = 'Changed parent'

			expect(factory.dirty).toBe(true)

			factory.reset()

			expect(factory.dirty).toBe(false)
			expect(factory.toModel()).toEqual({ child: { name: 'Loaded child' }, label: 'Loaded parent' })
		})
	})

	describe('FactoryArray', () => {
		it('adds, deletes, iterates, validates, and models child factories', () => {
			const factories = BaseFactory.asArray(() => new NameFactory())

			expect(factories.valid).toBe(true)
			expect(factories.dirty).toBe(false)

			const first = factories.add()
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
			const factories = BaseFactory.asArray(() => new NameFactory())

			factories.loadEntity([{ name: 'One' }, { name: 'Two' }])

			expect(factories.length).toBe(2)
			expect(factories.valid).toBe(true)
			expect(factories.dirty).toBe(false)
			expect(factories.toModel()).toEqual([{ name: 'One' }, { name: 'Two' }])

			factories.add().name = 'Three'
			expect(factories.dirty).toBe(true)

			factories.reset()

			expect(factories.length).toBe(2)
			expect(factories.dirty).toBe(false)
			expect(factories.toModel()).toEqual([{ name: 'One' }, { name: 'Two' }])
		})
	})
}
