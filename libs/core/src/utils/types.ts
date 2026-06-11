export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

type Prettify<T> = {
	[K in keyof T]: T[K]
} & {}

export type UndefinedToOptional<T> = Prettify<
	{
		[K in keyof T as undefined extends T[K] ? never : K]: T[K]
	} & {
		[K in keyof T as undefined extends T[K] ? K : never]?: T[K]
	}
>
