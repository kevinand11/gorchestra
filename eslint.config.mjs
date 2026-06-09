import base from '@k11/configs/eslint/base'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	...base,
	...tseslint.configs.recommendedTypeChecked,
	{
		ignores: ['coverage/**', '.husky/_/**'],
		settings: {
			'import/resolver': {
				typescript: {
					project: './tsconfig.eslint.json',
				},
			},
		},
	},
	{
		files: ['libs/**/*.ts'],
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
