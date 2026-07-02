import type { Pipe } from 'valleyed'

export type FormDraftLike<Entity = unknown, Model = unknown, Fields extends object = object> = {
	readonly dirty: boolean
	readonly errors: Record<string, string>
	readonly firstError: string
	readonly listenerValue: Fields
	readonly valid: boolean
	isDirty(...keys: (keyof Fields)[]): boolean
	listen(callback: () => void): void
	loadEntity(entity: Entity): unknown
	reset(): void
	toModel(): Model
}

export type FlatKeys<Fields extends object> = keyof {
	[Key in keyof Fields as Fields[Key] extends FormDraftLike ? never : Key]: boolean
}

export type InferEntity<T> = T extends FormDraftLike<infer Entity, unknown, object> ? Entity : never
export type InferModel<T> = T extends FormDraftLike<unknown, infer Model, object> ? Model : never
export type InferFields<T> = T extends FormDraftLike<unknown, unknown, infer Fields> ? Fields : never
export type FormDraftRules<Fields extends object> = { [Key in keyof Fields]: Pipe<unknown, unknown> }
