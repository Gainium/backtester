import eslint from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import typescript from '@typescript-eslint/parser'
import prettier from 'eslint-plugin-prettier'

export default [
  {
    ignores: ['dist/**/*', 'build/**/*', 'node_modules/**/*'],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: typescript,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        __dirname: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      prettier: prettier,
    },
    rules: {
      'prettier/prettier': 'warn',
      'no-unused-vars': 'off', // Use TypeScript's version instead
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-dupe-class-members': 'off', // This is valid in TypeScript with method overloading
      '@typescript-eslint/no-explicit-any': 'off', // Allow 'any' type
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-empty-pattern': 'warn',
      'no-extra-boolean-cast': 'warn',
    },
  },
]
