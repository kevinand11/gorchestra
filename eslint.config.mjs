import base from '@k11/configs/eslint/base'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{ ignores: ['coverage/**', '.husky/_/**', '**/.nuxt/**', '**/.output/**'] },
	...base,
	...tseslint.configs.recommendedTypeChecked,
	{
		settings: {
			'import/resolver': {
				typescript: {
					project: './tsconfig.eslint.json',
				},
			},
		},
	},
	{
		files: ['src/**/*.ts', 'libs/**/*.ts', 'consumers/**/*.ts'],
		languageOptions: {
			parserOptions: {
				project: './tsconfig.eslint.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
		},
	},
)
